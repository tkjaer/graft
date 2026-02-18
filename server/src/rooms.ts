import * as Y from "yjs";
import { WebSocket } from "ws";
import { Octokit } from "@octokit/rest";
import { docs } from "./sync.js";
import type { GraftPersistence } from "./persistence.js";

/**
 * Tracks active rooms (documents) and their connections.
 * Handles external change detection and merging.
 */
export class RoomManager {
  private connections = new Map<string, Set<WebSocket>>();

  constructor(private persistence: GraftPersistence) {}

  addConnection(roomName: string, ws: WebSocket): void {
    if (!this.connections.has(roomName)) {
      this.connections.set(roomName, new Set());
    }
    this.connections.get(roomName)!.add(ws);
  }

  removeConnection(roomName: string, ws: WebSocket): void {
    const conns = this.connections.get(roomName);
    if (conns) {
      conns.delete(ws);
      if (conns.size === 0) {
        this.connections.delete(roomName);
      }
    }
  }

  hasRoom(roomName: string): boolean {
    return docs.has(roomName);
  }

  getConnectionCount(roomName: string): number {
    return this.connections.get(roomName)?.size ?? 0;
  }

  /**
   * Handle an external change (detected via webhook or polling).
   * Performs a 3-way merge of the external change into the live Y.Doc.
   */
  async handleExternalChange(roomName: string): Promise<void> {
    const doc = docs.get(roomName);
    if (!doc) return;

    const meta = doc.getMap("meta");
    const owner = meta.get("owner") as string;
    const repo = meta.get("repo") as string;
    const branch = meta.get("branch") as string;
    const path = meta.get("path") as string;
    const savedContent = meta.get("savedContent") as string;

    if (!owner || !repo || !branch || !path) return;

    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

    try {
      // Fetch the latest version from GitHub
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });

      if (Array.isArray(data) || data.type !== "file") return;

      const theirs = Buffer.from(data.content, "base64").toString("utf-8");
      const base = savedContent || "";
      const markdownText = doc.getText("markdown");
      const ours = markdownText.toString();

      // If the content is the same, just update the SHA
      if (theirs === ours) {
        meta.set("sha", data.sha);
        return;
      }

      // 3-way merge
      const { merge } = await import("node-diff3");
      const result = merge(ours, base, theirs);

      if (!result.conflict) {
        const merged = result.result.join("");

        // Apply the merged content to the Y.Doc
        doc.transact(() => {
          markdownText.delete(0, markdownText.length);
          markdownText.insert(0, merged);
        });

        meta.set("sha", data.sha);
        meta.set("savedContent", merged);

        console.log(
          `[rooms] Auto-merged external change for ${roomName}`,
        );

        // Notify connected clients
        this.notifyClients(roomName, {
          type: "external-change-merged",
          message: "Document merged with external changes",
        });
      } else {
        console.warn(
          `[rooms] Merge conflict for ${roomName} — notifying clients`,
        );

        // Update SHA so next save doesn't conflict
        meta.set("sha", data.sha);

        // Notify clients about the conflict
        this.notifyClients(roomName, {
          type: "external-change-conflict",
          message: "External change conflicts with current edits",
          theirs,
          base,
        });
      }
    } catch (err: any) {
      console.error(
        `[rooms] Error handling external change for ${roomName}:`,
        err,
      );
    }
  }

  /**
   * Send a custom message to all clients connected to a room.
   */
  private notifyClients(roomName: string, message: object): void {
    const conns = this.connections.get(roomName);
    if (!conns) return;

    const data = JSON.stringify(message);
    for (const ws of conns) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}
