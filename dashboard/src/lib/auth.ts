/**
 * Edge-compatible auth helpers using Web Crypto API (HMAC-SHA256).
 * Used by both server routes and proxy (Edge runtime).
 *
 * Multi-user support:
 *   - AUTH_USERS = JSON array `[{"u":"...","p":"..."}, ...]`
 *   - Falls back to legacy AUTH_USERNAME / AUTH_PASSWORD as single user
 *
 * Session cookie token = HMAC-SHA256(username, AUTH_SECRET) → hex.
 * Stateless (no DB). Token rotates if AUTH_SECRET changes.
 */

export const SESSION_COOKIE = "session";

interface User {
  u: string;
  p: string;
}

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

function getUsers(): User[] {
  const json = env("AUTH_USERS");
  if (json) {
    try {
      const arr = JSON.parse(json);
      if (Array.isArray(arr)) {
        return arr.filter(
          (x): x is User => typeof x?.u === "string" && typeof x?.p === "string"
        );
      }
    } catch {
      /* fall through to legacy single-user */
    }
  }
  const u = env("AUTH_USERNAME");
  const p = env("AUTH_PASSWORD");
  if (u && p) return [{ u, p }];
  return [];
}

export function checkCredentials(username: string, password: string): boolean {
  for (const user of getUsers()) {
    if (constantTimeEqual(username, user.u) && constantTimeEqual(password, user.p)) {
      return true;
    }
  }
  return false;
}

export async function makeSessionToken(username: string): Promise<string> {
  return hmacSha256Hex(env("AUTH_SECRET"), username);
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !env("AUTH_SECRET")) return false;
  for (const user of getUsers()) {
    const expected = await makeSessionToken(user.u);
    if (constantTimeEqual(token, expected)) return true;
  }
  return false;
}

export function isAuthDisabled(): boolean {
  return getUsers().length === 0 || !env("AUTH_SECRET");
}
