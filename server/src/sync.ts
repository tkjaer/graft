/**
 * Minimal y-websocket sync implementation.
 *
 * Based on y-websocket's server utils but simplified for Graft:
 * - Custom persistence via GraftPersistence
 * - Room management via RoomManager
 * - No built-in HTTP server (handled by index.ts)
 */

import * as Y from "yjs";
import {
  readSyncMessage,
  writeSyncStep1,
  writeUpdate,
} from "y-protocols/sync";
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { GraftPersistence } from "./persistence.js";

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;

/** All active Y.Docs keyed by room name */
export const docs = new Map<string, Y.Doc>();

/** Connections per document */
const docConns = new Map<Y.Doc, Set<WebSocket>>();

function getOrCreateDoc(
  roomName: string,
  persistence: GraftPersistence,
): { doc: Y.Doc; isNew: boolean } {
  const existing = docs.get(roomName);
  if (existing) return { doc: existing, isNew: false };

  const doc = new Y.Doc();
  (doc as any).name = roomName;
  (doc as any).awareness = new Awareness(doc);

  docs.set(roomName, doc);
  docConns.set(doc, new Set());

  // Listen for updates and schedule persistence
  doc.on("update", (_update: Uint8Array, origin: any) => {
    // Don't schedule save for updates from persistence loading
    if (origin === "persistence-load") return;

    const conns = docConns.get(doc);
    if (!conns) return;

    // Broadcast update to all connected clients
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    writeUpdate(encoder, _update);
    const message = encoding.toUint8Array(encoder);

    for (const conn of conns) {
      if (conn.readyState === WebSocket.OPEN && conn !== origin) {
        conn.send(message);
      }
    }

    // Schedule debounced save
    persistence.scheduleSave(roomName, doc);
  });

  return { doc, isNew: true };
}

export function setupWSConnection(
  ws: WebSocket,
  req: IncomingMessage,
  roomName: string,
  persistence: GraftPersistence,
): void {
  const { doc, isNew } = getOrCreateDoc(roomName, persistence);
  const awareness: Awareness = (doc as any).awareness;
  const conns = docConns.get(doc)!;

  conns.add(ws);

  // Load document from GitHub if this is a new room
  if (isNew) {
    persistence.loadDocument(roomName, doc).catch((err) => {
      console.error(`[sync] Error loading document ${roomName}:`, err);
    });
  }

  // Handle incoming messages
  ws.on("message", (data: Buffer) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MSG_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          readSyncMessage(decoder, encoder, doc, ws);
          if (encoding.length(encoder) > 1) {
            ws.send(encoding.toUint8Array(encoder));
          }
          break;
        }
        case MSG_AWARENESS: {
          applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            ws,
          );
          break;
        }
      }
    } catch (err) {
      console.error(`[sync] Error handling message in ${roomName}:`, err);
    }
  });

  ws.on("close", () => {
    conns.delete(ws);

    // Remove awareness states for this connection
    const clientIds = Array.from(awareness.getStates().keys()).filter(
      (clientId) => clientId !== doc.clientID,
    );
    // Only remove our own client's awareness
    removeAwarenessStates(awareness, [doc.clientID], null);

    // If no more connections, flush and clean up
    if (conns.size === 0) {
      persistence.onRoomEmpty(roomName, doc).then(() => {
        docs.delete(roomName);
        docConns.delete(doc);
        doc.destroy();
      }).catch((err) => {
        console.error(`[sync] Error on room empty ${roomName}:`, err);
      });
    }
  });

  // Send initial sync step 1
  {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));
  }

  // Broadcast current awareness state
  const awarenessStates = awareness.getStates();
  if (awarenessStates.size > 0) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(awareness, Array.from(awarenessStates.keys())),
    );
    ws.send(encoding.toUint8Array(encoder));
  }

  // Listen for awareness updates and broadcast
  const awarenessChangeHandler = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: any,
  ) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(awareness, changedClients),
    );
    const message = encoding.toUint8Array(encoder);

    for (const conn of conns) {
      if (conn.readyState === WebSocket.OPEN) {
        conn.send(message);
      }
    }
  };

  awareness.on("update", awarenessChangeHandler);

  ws.on("close", () => {
    awareness.off("update", awarenessChangeHandler);
  });
}
