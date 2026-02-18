/**
 * Client-side collaboration module.
 *
 * Sets up a Yjs WebSocket provider for real-time sync with the
 * Graft sync server. Handles connection, reconnection with jitter,
 * offline fallback, and awareness (presence/cursors).
 */

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { Awareness } from "y-protocols/awareness";

export interface CollaborationConfig {
  /** Sync server WebSocket URL (e.g., "wss://graft-sync.example.com") */
  serverUrl: string;
  /** Room ID: owner/repo/branch/path */
  roomId: string;
  /** GitHub auth token */
  token: string;
  /** Current user info for awareness */
  user: {
    name: string;
    color: string;
    avatar?: string;
  };
  /** Called when connection status changes */
  onStatusChange?: (status: "connecting" | "connected" | "disconnected") => void;
  /** Called when an external change is merged */
  onExternalMerge?: (message: string) => void;
  /** Called when an external change conflicts */
  onExternalConflict?: (theirs: string, base: string) => void;
}

export interface CollaborationProvider {
  doc: Y.Doc;
  provider: WebsocketProvider;
  awareness: Awareness;
  destroy: () => void;
}

/** Pre-defined cursor colors for awareness */
const CURSOR_COLORS = [
  "#e06c75", // red
  "#61afef", // blue
  "#98c379", // green
  "#d19a66", // orange
  "#c678dd", // purple
  "#56b6c2", // cyan
  "#e5c07b", // yellow
  "#be5046", // dark red
];

/**
 * Pick a deterministic color for a user based on their name.
 */
export function userColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

/**
 * Create a Yjs collaboration provider connected to the sync server.
 */
export function createCollaborationProvider(
  config: CollaborationConfig,
): CollaborationProvider {
  const doc = new Y.Doc();

  // Build the WebSocket URL with auth token
  const wsUrl = `${config.serverUrl}/ws/${config.roomId}`;

  const provider = new WebsocketProvider(wsUrl, config.roomId, doc, {
    params: { token: config.token },
    connect: true,
    // Reconnect with exponential backoff + jitter
    maxBackoffTime: 10000,
  });

  const awareness = provider.awareness;

  // Set local awareness state (cursor, user info)
  awareness.setLocalStateField("user", {
    name: config.user.name,
    color: config.user.color,
    avatar: config.user.avatar,
  });

  // Status change handler
  provider.on("status", ({ status }: { status: string }) => {
    config.onStatusChange?.(
      status as "connecting" | "connected" | "disconnected",
    );
  });

  // Handle custom messages from the server (external change notifications)
  provider.ws?.addEventListener("message", (event) => {
    try {
      // Try parsing as JSON (custom server messages)
      const data = JSON.parse(
        typeof event.data === "string"
          ? event.data
          : new TextDecoder().decode(event.data),
      );

      if (data.type === "external-change-merged") {
        config.onExternalMerge?.(data.message);
      } else if (data.type === "external-change-conflict") {
        config.onExternalConflict?.(data.theirs, data.base);
      }
    } catch {
      // Not JSON — this is a Yjs sync message, ignore
    }
  });

  return {
    doc,
    provider,
    awareness,
    destroy: () => {
      awareness.destroy();
      provider.destroy();
      doc.destroy();
    },
  };
}

/**
 * Get a list of connected users from awareness state.
 */
export function getConnectedUsers(
  awareness: Awareness,
): Array<{ clientId: number; name: string; color: string; avatar?: string }> {
  const users: Array<{
    clientId: number;
    name: string;
    color: string;
    avatar?: string;
  }> = [];

  awareness.getStates().forEach((state, clientId) => {
    if (state.user) {
      users.push({
        clientId,
        name: state.user.name,
        color: state.user.color,
        avatar: state.user.avatar,
      });
    }
  });

  return users;
}
