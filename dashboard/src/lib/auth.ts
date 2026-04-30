/**
 * Edge-compatible auth helpers using Web Crypto API (HMAC-SHA256).
 * Used by both server routes and middleware (Edge runtime).
 *
 * Cookie token = HMAC-SHA256(`${username}:${password}`, AUTH_SECRET) → hex.
 * Stateless (no DB), but token rotates whenever credentials or secret changes.
 */

export const SESSION_COOKIE = "session";

function env(name: string): string {
  return process.env[name] || "";
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function hmacSha256Hex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function checkCredentials(username: string, password: string): boolean {
  const u = env("AUTH_USERNAME");
  const p = env("AUTH_PASSWORD");
  if (!u || !p) return false;
  return constantTimeEqual(username, u) && constantTimeEqual(password, p);
}

export async function makeSessionToken(): Promise<string> {
  return hmacSha256Hex(env("AUTH_SECRET"), `${env("AUTH_USERNAME")}:${env("AUTH_PASSWORD")}`);
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  if (!env("AUTH_SECRET") || !env("AUTH_USERNAME") || !env("AUTH_PASSWORD")) return false;
  const expected = await makeSessionToken();
  return constantTimeEqual(token, expected);
}

export function isAuthDisabled(): boolean {
  // If credentials/secret not configured, auth is disabled (open access).
  return !env("AUTH_USERNAME") || !env("AUTH_PASSWORD") || !env("AUTH_SECRET");
}
