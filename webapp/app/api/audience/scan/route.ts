import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/audience/scan → fires scan-audience-connections
export async function POST() {
  const accountId = await getActiveAccountId();
  try {
    const handle = await tasks.trigger("scan-audience-connections", { accountId });
    return NextResponse.json({ run_id: handle.id });
  } catch (e) {
    return NextResponse.json(
      { error: "trigger_failed", message: (e as Error).message },
      { status: 502 },
    );
  }
}

// GET /api/audience/scan → latest scan row for progress polling
export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("audience_scans")
    .select("id, scan_type, run_id, status, total_walked, matches_upserted, error, started_at, finished_at")
    .eq("account_id", accountId)
    .eq("scan_type", "connections")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ scan: data ?? null });
}
