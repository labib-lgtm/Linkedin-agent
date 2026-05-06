import { NextResponse, type NextRequest } from "next/server";
import { runDigest, DigestError } from "@/lib/digest";
import { OpenRouterError } from "@/lib/openrouter";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Outer safety net guarantees a JSON response so the client's res.json()
// never sees Vercel's default HTML error page.
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[digest/run] uncaught", e);
    return NextResponse.json(
      { error: "uncaught", message: (e as Error)?.message ?? String(e) },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest) {
  let body: { week_start?: string } = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }

  try {
    const digest = await runDigest(body.week_start);
    return NextResponse.json({ digest });
  } catch (e) {
    if (e instanceof DigestError) {
      console.error("[digest/run] DigestError", e.code, e.message);
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    if (e instanceof OpenRouterError) {
      console.error("[digest/run] OpenRouterError", e.status, e.body);
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    console.error("[digest/run] unhandled", e);
    return NextResponse.json(
      { error: "digest_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
