import { NextResponse, type NextRequest } from "next/server";
import { prepareDigest, DigestError } from "@/lib/digest";
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
    // Phase 1 only: read + LLM, no DB write. The client follows up with
    // POST /api/digest/save to persist (split so each call fits Hobby's
    // 10s function ceiling on its own).
    const tHandle = Date.now();
    const digest = await prepareDigest(body.week_start);
    console.info("[digest/run] prepared", { ms: Date.now() - tHandle });
    const tResp = Date.now();
    const resp = NextResponse.json({ digest });
    console.info("[digest/run] response built", { ms: Date.now() - tResp });
    return resp;
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
