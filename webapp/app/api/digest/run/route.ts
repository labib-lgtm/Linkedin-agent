import { NextResponse, type NextRequest } from "next/server";
import { prepareDigest, DigestError } from "@/lib/digest";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Phase 1 of the three-phase digest flow:
//   /run        -> DB reads only, returns posts + the LLM prompt body
//   /summarize  -> LLM call, returns pattern_summary
//   /save       -> persist the merged payload
// Each phase owns its own 10s budget on Vercel Hobby. The reads phase
// finishes in ~1s, leaving the other two with full headroom.
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
    const read = await prepareDigest(body.week_start);
    return NextResponse.json({ read });
  } catch (e) {
    if (e instanceof DigestError) {
      console.error("[digest/run] DigestError", e.code, e.message);
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    console.error("[digest/run] unhandled", e);
    return NextResponse.json(
      { error: "digest_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
