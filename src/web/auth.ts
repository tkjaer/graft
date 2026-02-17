/**
 * GitHub Device Flow authentication.
 * No client secret required — runs entirely in the browser.
 *
 * OAuth requests are routed through a CORS proxy (Cloudflare Worker)
 * because github.com/login/* endpoints don't send CORS headers.
 *
 * Flow:
 * 1. POST to proxy /login/device/code with client_id → get user_code + verification_uri
 * 2. User opens verification_uri and enters user_code
 * 3. Poll POST proxy /login/oauth/access_token until user approves
 * 4. Store token in sessionStorage
 */

const STORAGE_KEY = "graft:github_token";
const GITHUB_CLIENT_ID = import.meta.env.VITE_GITHUB_CLIENT_ID ?? "";
const AUTH_PROXY_URL = import.meta.env.VITE_AUTH_PROXY_URL ?? "";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * Get the stored GitHub token, or null if not authenticated.
 */
export function getToken(): string | null {
  return sessionStorage.getItem(STORAGE_KEY);
}

/**
 * Store the GitHub token.
 */
export function setToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token);
}

/**
 * Clear the stored GitHub token.
 */
export function clearToken(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if we have a valid stored token by making a test API call.
 */
export async function validateToken(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Step 1: Request a device code from GitHub.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  if (!GITHUB_CLIENT_ID) {
    throw new Error(
      "VITE_GITHUB_CLIENT_ID is not set. Create a GitHub App and set this env var.",
    );
  }
  if (!AUTH_PROXY_URL) {
    throw new Error(
      "VITE_AUTH_PROXY_URL is not set. Deploy the worker/ CORS proxy and set this env var.",
    );
  }

  const res = await fetch(`${AUTH_PROXY_URL}/login/device/code`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: "repo",
    }),
  });

  if (!res.ok) {
    throw new Error(`Device code request failed: ${res.status}`);
  }

  return res.json();
}

/**
 * Step 2: Poll for the access token after user enters the code.
 * Resolves with the access token once the user approves.
 * Rejects if the code expires or is denied.
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onTick?: () => void,
): Promise<string> {
  const deadline = Date.now() + expiresIn * 1000;
  const pollInterval = Math.max(interval, 5) * 1000; // GitHub minimum is 5s

  while (Date.now() < deadline) {
    await sleep(pollInterval);
    onTick?.();

    const res = await fetch(`${AUTH_PROXY_URL}/login/oauth/access_token`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    if (!res.ok) continue;

    const data = await res.json();

    if (data.access_token) {
      setToken(data.access_token);
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      continue;
    }

    if (data.error === "slow_down") {
      // Back off — GitHub asked us to slow down
      await sleep(5000);
      continue;
    }

    if (data.error === "expired_token") {
      throw new Error("Device code expired. Please try again.");
    }

    if (data.error === "access_denied") {
      throw new Error("Access denied. The user cancelled authorization.");
    }

    throw new Error(`Unexpected response: ${data.error}`);
  }

  throw new Error("Device code expired. Please try again.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
