import type { IncomingMessage, ServerResponse } from "node:http";
import * as crypto from "node:crypto";
import type { RoomManager } from "./rooms.js";

/**
 * Create a handler for GitHub webhook push events.
 * Detects external commits and triggers 3-way merge into the live Y.Doc.
 */
export function createWebhookHandler(
  secret: string,
  rooms: RoomManager,
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req);

    // Verify signature if secret is configured
    if (secret) {
      const signature = req.headers["x-hub-signature-256"] as string;
      if (!signature || !verifySignature(secret, body, signature)) {
        res.writeHead(401);
        res.end("Invalid signature");
        return;
      }
    }

    const event = req.headers["x-github-event"] as string;
    if (event !== "push") {
      res.writeHead(200);
      res.end("OK (ignored)");
      return;
    }

    try {
      const payload = JSON.parse(body);
      await handlePushEvent(payload, rooms);
      res.writeHead(200);
      res.end("OK");
    } catch (err: any) {
      console.error("[webhook] Error handling push event:", err);
      res.writeHead(500);
      res.end("Internal error");
    }
  };
}

interface PushPayload {
  ref: string; // e.g., "refs/heads/main"
  repository: {
    full_name: string; // e.g., "owner/repo"
  };
  commits: Array<{
    id: string;
    author: { username?: string };
    committer: { username?: string };
    added: string[];
    modified: string[];
    removed: string[];
  }>;
  pusher: {
    name: string;
  };
}

async function handlePushEvent(
  payload: PushPayload,
  rooms: RoomManager,
): Promise<void> {
  const branch = payload.ref.replace("refs/heads/", "");
  const [owner, repo] = payload.repository.full_name.split("/");

  // Collect all changed files
  const changedFiles = new Set<string>();
  for (const commit of payload.commits) {
    // Skip commits made by the sync server itself
    const committer = commit.committer?.username || "";
    if (committer === "graft-sync" || committer === "github-actions[bot]") {
      continue;
    }

    for (const f of [...commit.added, ...commit.modified]) {
      changedFiles.add(f);
    }
  }

  if (changedFiles.size === 0) return;

  // Check if any changed files have active rooms
  for (const file of changedFiles) {
    const roomName = `${owner}/${repo}/${branch}/${file}`;
    if (rooms.hasRoom(roomName)) {
      console.log(
        `[webhook] External change detected for ${roomName}, triggering merge`,
      );
      await rooms.handleExternalChange(roomName);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function verifySignature(
  secret: string,
  body: string,
  signature: string,
): boolean {
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(body).digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}
