import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/audience/followers/scan → fires scan-audience-followers with a
// budget clamped by the task itself (Phase A: max 20; task rejects higher).
export async function POST(req: NextRequest) {
  const accountId = await getActiveAccountId();
  let body: { budget?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body ok
  }
  const budget = Math.max(1, Math.min(Number(body.budget) || 10, 200));
  try {
    const handle = await tasks.trigger("scan-audience-followers", { accountId, budget });
    return NextResponse.json({ run_id: handle.id, budget });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}

// GET /api/audience/followers/scan → latest follower scan row
export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("audience_scans")
    .select("id, run_id, status, total_walked, matches_upserted, budget, error, started_at, finished_at")
    .eq("account_id", accountId)
    .eq("scan_type", "followers")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ scan: data ?? null });
}
