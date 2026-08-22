/**
 * Admin session: a signed cookie, no user table.
 *
 * There is exactly one operator, so a password check plus an HMAC-signed
 * expiry is the whole of it. Web Crypto only, so this runs unchanged in
 * middleware (edge) and in route handlers (node).
 */

export const ADMIN_COOKIE = "tw_admin";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secret(): string | null {
  return process.env.ADMIN_SECRET ?? null;
}

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SECRET);
}

function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string | null> {
  const key = secret();
  if (!key) return null;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return b64url(new Uint8Array(mac));
}

/** Constant-time compare — a timing leak on a one-user panel is still a leak. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSession(): Promise<string | null> {
  const expires = Date.now() + MAX_AGE_SECONDS * 1000;
  const payload = String(expires);
  const signature = await sign(payload);
  return signature ? `${payload}.${signature}` : null;
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = await sign(payload);
  if (!expected || !safeEqual(signature, expected)) return false;
  return Number(payload) > Date.now();
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  // Hash both sides first so the compare length never leaks the real length.
  const digest = async (value: string) =>
    b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
  return safeEqual(await digest(candidate), await digest(expected));
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};
