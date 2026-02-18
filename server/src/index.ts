import * as http from "node:http";
import * as Y from "yjs";
import { WebSocketServer, WebSocket } from "ws";
import { setupWSConnection, docs } from "./sync.js";
import { GraftPersistence } from "./persistence.js";
import { authenticateUpgrade, type AuthenticatedRequest } from "./auth.js";
import { createWebhookHandler } from "./webhook.js";
import { RoomManager } from "./rooms.js";

const PORT = parseInt(process.env.PORT || "4000", 10);
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

const persistence = new GraftPersistence();
const rooms = new RoomManager(persistence);

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: docs.size }));
    return;
  }

  // Webhook endpoint
  if (req.method === "POST" && req.url === "/webhooks/github") {
    const handler = createWebhookHandler(GITHUB_WEBHOOK_SECRET, rooms);
    await handler(req, res);
    return;
  }

  // Metrics (basic)
  if (req.method === "GET" && req.url === "/metrics") {
    let totalConnections = 0;
    for (const [, doc] of docs) {
      const meta = doc.getMap("meta");
      const conns = meta.get("connections");
      if (typeof conns === "number") totalConnections += conns;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        rooms: docs.size,
        connections: totalConnections,
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (request, socket, head) => {
  try {
    const authInfo = await authenticateUpgrade(request);

    wss.handleUpgrade(request, socket, head, (ws) => {
      // Attach auth info to the request for the connection handler
      (request as AuthenticatedRequest).auth = authInfo;
      wss.emit("connection", ws, request);
    });
  } catch (err: any) {
    socket.write(
      `HTTP/1.1 ${err.status || 401} ${err.message || "Unauthorized"}\r\n\r\n`,
    );
    socket.destroy();
  }
});

wss.on("connection", async (ws: WebSocket, req: http.IncomingMessage) => {
  const authReq = req as AuthenticatedRequest;
  const roomName = parseRoomFromUrl(req.url || "");

  if (!roomName) {
    ws.close(4400, "Missing room parameter");
    return;
  }

  // Check repo access
  if (authReq.auth) {
    const { owner, repo } = parseRoomId(roomName);
    const hasAccess = await authReq.auth.checkRepoAccess(owner, repo);
    if (!hasAccess) {
      ws.close(4403, "No access to repository");
      return;
    }
  }

  // Register the room for tracking
  rooms.addConnection(roomName, ws);

  setupWSConnection(ws, req, roomName, persistence);

  ws.on("close", () => {
    rooms.removeConnection(roomName, ws);
  });
});

// ── Room ID parsing ──────────────────────────────────────────────

/** Extract room name from WebSocket URL: /ws/:owner/:repo/:branch/:path */
function parseRoomFromUrl(url: string): string | null {
  // Expected format: /ws/owner/repo/branch/path/to/file.md
  const match = url.match(/^\/ws\/(.+)$/);
  return match ? match[1] : null;
}

/** Parse a room ID into owner/repo/branch/path components */
export function parseRoomId(roomId: string): {
  owner: string;
  repo: string;
  branch: string;
  path: string;
} {
  const parts = roomId.split("/");
  if (parts.length < 4) {
    throw new Error(`Invalid room ID: ${roomId}`);
  }
  return {
    owner: parts[0],
    repo: parts[1],
    branch: parts[2],
    path: parts.slice(3).join("/"),
  };
}

// ── Graceful shutdown ────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[graft] ${signal} received, shutting down gracefully…`);

  // 1. Stop accepting new connections
  server.close();

  // 2. Flush all dirty Y.Docs
  console.log(`[graft] Flushing ${docs.size} documents…`);
  const flushPromises: Promise<void>[] = [];
  for (const [roomName, doc] of docs) {
    flushPromises.push(
      persistence
        .flushDocument(roomName, doc)
        .catch((err) =>
          console.error(`[graft] Error flushing ${roomName}:`, err),
        ),
    );
  }
  await Promise.allSettled(flushPromises);

  // 3. Send close frames to all clients with "reconnect" reason
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(4000, "server-shutdown-reconnect");
    }
  }

  // 4. Wait for connections to drain (max 30s)
  const drainTimeout = setTimeout(() => {
    console.log("[graft] Drain timeout reached, forcing exit");
    process.exit(0);
  }, 30_000);
  drainTimeout.unref();

  // Wait for all clients to disconnect
  await new Promise<void>((resolve) => {
    const check = () => {
      if (wss.clients.size === 0) {
        resolve();
      } else {
        setTimeout(check, 500);
      }
    };
    check();
  });

  clearTimeout(drainTimeout);
  console.log("[graft] Shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ── Start ────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[graft] Sync server listening on :${PORT}`);
});
