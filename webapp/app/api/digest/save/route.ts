import { NextResponse, type NextRequest } from "next/server";
import { saveDigest, DigestError, type DigestPayloadOut } from "@/lib/digest";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Phase 2 of the digest flow — receives the prepared payload from the
// client (which got it from /api/digest/run) and persists it. Splitting
// the LLM call from the upsert keeps each step inside Hobby's 10s ceiling.
export async function POST(req: NextRequest) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[digest/save] uncaught", e);
    return NextResponse.json(
      { error: "uncaught", message: (e as Error)?.message ?? String(e) },
      { status: 500 },
    );
  }
}

async function handle(req: NextRequest) {
  let body: { digest?: DigestPayloadOut };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const payload = body.digest;
  if (!payload || !payload.week_start || !Array.isArray(payload.top_posts)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  try {
    // account_id arrives from /digest/run's response, but defend against
    // older clients by falling back to the active account here.
    const accountId = payload.account_id || (await getActiveAccountId());
    const result = await saveDigest({ ...payload, account_id: accountId });
    return NextResponse.json({ saved: true, ...result });
  } catch (e) {
    if (e instanceof DigestError) {
      console.error("[digest/save] DigestError", e.code, e.message);
      return NextResponse.json({ error: e.code, message: e.message }, { status: e.status });
    }
    console.error("[digest/save] unhandled", e);
    return NextResponse.json(
      { error: "save_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
