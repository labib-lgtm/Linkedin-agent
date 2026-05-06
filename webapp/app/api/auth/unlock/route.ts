import { NextResponse, type NextRequest } from "next/server";
import {
  signSession,
  pinsMatch,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
} from "@/lib/auth";

// In-memory rate limit. Vercel serverless workers can be reused for several
// minutes, so this catches drive-by guesses in the same warm container. Cold
// starts reset the map — a determined attacker can re-roll, which is why a
// 4-digit PIN is fine only behind a non-public URL. If we ever expose this
// publicly, add Upstash/Redis-backed rate limiting.
type Bucket = { count: number; resetAt: number };
const RATE_LIMIT = new Map<string, Bucket>();
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function checkLimit(ip: string): { ok: boolean; remaining: number } {
  const now = Date.now();
  const bucket = RATE_LIMIT.get(ip);
  if (!bucket || bucket.resetAt < now) {
    RATE_LIMIT.set(ip, { count: 0, resetAt: now + WINDOW_MS });
    return { ok: true, remaining: MAX_FAILS };
  }
  return { ok: bucket.count < MAX_FAILS, remaining: MAX_FAILS - bucket.count };
}

function recordFailure(ip: string) {
  const now = Date.now();
  const bucket = RATE_LIMIT.get(ip) ?? { count: 0, resetAt: now + WINDOW_MS };
  bucket.count += 1;
  RATE_LIMIT.set(ip, bucket);
}

function resetLimit(ip: string) {
  RATE_LIMIT.delete(ip);
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = checkLimit(ip);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_attempts", retry_after_min: 15 },
      { status: 429 },
    );
  }

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const pin = String(body.pin ?? "");
  const expected = process.env.APP_PIN;
  if (!expected) {
    return NextResponse.json(
      { error: "APP_PIN env var not set" },
      { status: 500 },
    );
  }

  if (!pinsMatch(pin, expected)) {
    recordFailure(ip);
    return NextResponse.json(
      { error: "wrong_pin", remaining: Math.max(0, limit.remaining - 1) },
      { status: 401 },
    );
  }

  resetLimit(ip);

  const cookie = await signSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
  return res;
}
