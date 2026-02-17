/**
 * Cloudflare Worker — CORS proxy for GitHub OAuth device flow.
 *
 * GitHub's OAuth endpoints (github.com/login/*) don't support CORS,
 * so browser-based apps can't call them directly. This worker forwards
 * the two device-flow requests and adds CORS headers.
 *
 * Only proxies POST to /login/device/code and /login/oauth/access_token.
 * Locked to a single allowed origin and client ID.
 */

export interface Env {
  ALLOWED_ORIGIN: string;
  GITHUB_CLIENT_ID: string;
}

const ALLOWED_PATHS = ["/login/device/code", "/login/oauth/access_token"];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin") ?? "";

    // CORS preflight
    if (request.method === "OPTIONS") {
      if (origin !== env.ALLOWED_ORIGIN) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(null, {
        headers: corsHeaders(env.ALLOWED_ORIGIN),
      });
    }

    // Only POST to allowed paths
    const url = new URL(request.url);
    if (request.method !== "POST" || !ALLOWED_PATHS.includes(url.pathname)) {
      return new Response("Not found", { status: 404 });
    }

    // Origin check
    if (origin !== env.ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }

    // Validate client_id matches
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (body.client_id !== env.GITHUB_CLIENT_ID) {
      return new Response("Invalid client_id", { status: 403 });
    }

    // Forward to GitHub
    const res = await fetch("https://github.com" + url.pathname, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
      },
    });
  },
};

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Max-Age": "86400",
  };
}
