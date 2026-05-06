// PIN-gate auth. The whole app is locked behind a 4-digit PIN; on success we
// set a signed httpOnly cookie that middleware verifies on every request.
//
// Uses Web Crypto API (HMAC-SHA256) so the same module runs in both Edge
// runtime (middleware.ts) and Node runtime (route handlers).

const COOKIE_NAME = "lynx_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "SESSION_SECRET env var must be set to at least 16 characters",
    );
  }
  return s;
}

function b64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return b64urlEncode(sig);
}

// Constant-time string compare. Web Crypto has no timingSafeEqual, so we
// roll our own — XOR every byte and OR the result; only zero if identical.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = String(exp);
  const sig = await hmac(payload, getSecret());
  return `${payload}.${sig}`;
}

export async function verifySession(cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const [payload, sig] = cookieValue.split(".");
  if (!payload || !sig) return false;

  const exp = Number(payload);
  if (!Number.isFinite(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;

  let expected: string;
  try {
    expected = await hmac(payload, getSecret());
  } catch {
    return false;
  }
  return safeEqual(sig, expected);
}

// Constant-time PIN compare. Use TextEncoder so emoji/unicode don't sneak in.
export function pinsMatch(submitted: string, expected: string): boolean {
  const a = new TextEncoder().encode(submitted);
  const b = new TextEncoder().encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_COOKIE_MAX_AGE = SESSION_TTL_SECONDS;

// We avoid Edge-runtime imports of node modules. b64urlDecode is exported in
// case future code needs to parse signed payloads (none today).
export const _internal = { b64urlDecode };
