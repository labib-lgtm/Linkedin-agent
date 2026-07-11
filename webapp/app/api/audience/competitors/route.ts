import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/audience/competitors
//
// Reuses existing `competitors` + `competitor_snapshots` — returns each
// competitor with current follower count, 30d delta, and engager count
// mined this month. Snapshots power the time-series chart in the
// detail view.
export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("id, identifier, provider_id, name")
    .eq("account_id", accountId)
    .eq("is_self", false)
    .is("archived_at", null)
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = [];
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();
  const dayAgo30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  for (const c of competitors ?? []) {
    // Latest snapshot
    const { data: latest } = await supabase
      .from("competitor_snapshots")
      .select("followers_count, connections_count, captured_at")
      .eq("competitor_id", c.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // 30-day-old snapshot for delta
    const { data: baseline } = await supabase
      .from("competitor_snapshots")
      .select("followers_count")
      .eq("competitor_id", c.id)
      .lte("captured_at", dayAgo30)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Engagers this month
    const { count: engagersThisMonth } = await supabase
      .from("competitor_engagers")
      .select("id", { count: "exact", head: true })
      .eq("competitor_id", c.id)
      .gte("last_seen_at", monthIso);

    const currentFollowers = (latest?.followers_count as number | null) ?? null;
    const baselineFollowers = (baseline?.followers_count as number | null) ?? null;
    const delta30d =
      currentFollowers != null && baselineFollowers != null
        ? currentFollowers - baselineFollowers
        : null;

    rows.push({
      id: c.id,
      name: c.name,
      identifier: c.identifier,
      provider_id: c.provider_id,
      followers_count: currentFollowers,
      connections_count: latest?.connections_count ?? null,
      delta_30d: delta30d,
      last_snapshot_at: latest?.captured_at ?? null,
      engagers_this_month: engagersThisMonth ?? 0,
    });
  }

  return NextResponse.json({ competitors: rows });
}
