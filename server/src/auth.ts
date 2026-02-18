import type { IncomingMessage } from "node:http";
import { Octokit } from "@octokit/rest";

export interface AuthInfo {
  login: string;
  name: string | null;
  avatarUrl: string;
  token: string;
  checkRepoAccess: (owner: string, repo: string) => Promise<boolean>;
}

export interface AuthenticatedRequest extends IncomingMessage {
  auth?: AuthInfo;
}

/**
 * Authenticate a WebSocket upgrade request.
 * Expects a Bearer token in the Authorization header or as a `token` query parameter.
 */
export async function authenticateUpgrade(
  req: IncomingMessage,
): Promise<AuthInfo> {
  const token = extractToken(req);

  if (!token) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  const octokit = new Octokit({ auth: token });

  try {
    const { data: user } = await octokit.users.getAuthenticated();

    return {
      login: user.login,
      name: user.name ?? null,
      avatarUrl: user.avatar_url,
      token,
      checkRepoAccess: async (owner: string, repo: string): Promise<boolean> => {
        try {
          await octokit.repos.get({ owner, repo });
          return true;
        } catch (err: any) {
          if (err.status === 404 || err.status === 403) return false;
          throw err;
        }
      },
    };
  } catch (err: any) {
    throw Object.assign(new Error("Invalid token"), { status: 401 });
  }
}

function extractToken(req: IncomingMessage): string | null {
  // 1. Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // 2. Query parameter
  const url = new URL(req.url || "", `http://${req.headers.host}`);
  const tokenParam = url.searchParams.get("token");
  if (tokenParam) return tokenParam;

  // 3. Sec-WebSocket-Protocol (used by browsers that can't set headers on WebSocket)
  const protocols = req.headers["sec-websocket-protocol"];
  if (protocols) {
    // Format: "graft-token, <actual-token>"
    const parts = protocols.split(",").map((p) => p.trim());
    const tokenPart = parts.find((p) => p.startsWith("graft-token-"));
    if (tokenPart) {
      return tokenPart.slice("graft-token-".length);
    }
  }

  return null;
}
