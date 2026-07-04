import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/outreach/pakistan-cleanup/scan
//
// Fires the scan-pakistan-connections Trigger.dev task for the active
// account. Returns { run_id }. The scan itself walks every relation on the
// LinkedIn account, filters by location, and upserts matches into
// pakistan_cleanup_targets. UI polls /targets and /latest for progress.
export async function POST() {
  const accountId = await getActiveAccountId();
  try {
    const handle = await tasks.trigger("scan-pakistan-connections", {
      accountId,
    });
    return NextResponse.json({ run_id: handle.id });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}

// GET /api/outreach/pakistan-cleanup/scan
//
// Returns the most recent scan row for progress polling.
export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("pakistan_cleanup_scans")
    .select(
      "id, run_id, status, total_relations, profiles_fetched, matches_found, error, started_at, finished_at",
    )
    .eq("account_id", accountId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ scan: data ?? null });
}
