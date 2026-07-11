import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/audience/report/[month]
// month format: YYYY-MM (e.g. "2026-07"). Returns a rollup across audience
// growth, invitation activity, and sourced prospects — the data behind Tab 5.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ month: string }> },
) {
  const { month } = await params;
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return NextResponse.json({ error: "invalid month" }, { status: 400 });
  const [, y, m] = match;

  const monthStart = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
  const nextMonthStart = new Date(Date.UTC(Number(y), Number(m), 1));
  const monthStartIso = monthStart.toISOString();
  const nextMonthStartIso = nextMonthStart.toISOString();

  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  // 1. Audience growth: snapshots at both ends of the month
  const { data: firstSnap } = await supabase
    .from("own_account_snapshots")
    .select("captured_at, followers_count, connections_count")
    .eq("account_id", accountId)
    .gte("captured_at", monthStartIso)
    .lt("captured_at", nextMonthStartIso)
    .order("captured_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: lastSnap } = await supabase
    .from("own_account_snapshots")
    .select("captured_at, followers_count, connections_count")
    .eq("account_id", accountId)
    .gte("captured_at", monthStartIso)
    .lt("captured_at", nextMonthStartIso)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 2. Requests activity
  const { data: invitesInMonth } = await supabase
    .from("outgoing_invitations")
    .select("status, sent_at, accepted_at")
    .eq("account_id", accountId)
    .gte("sent_at", monthStartIso)
    .lt("sent_at", nextMonthStartIso);

  const invites = invitesInMonth ?? [];
  const totalSent = invites.length;
  const accepted = invites.filter((r) => r.status === "accepted").length;
  const withdrawn = invites.filter((r) => r.status === "withdrawn").length;

  // 3. New prospects sourced from competitor mining this month
  const { count: newProspectsFromCompetitors } = await supabase
    .from("competitor_engagers")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("first_seen_at", monthStartIso)
    .lt("first_seen_at", nextMonthStartIso);

  // 4. Demographic snapshot at end of month (top-N from current audience_connections)
  const { count: currentConnections } = await supabase
    .from("audience_connections")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  return NextResponse.json({
    month,
    audience: {
      followers_start: firstSnap?.followers_count ?? null,
      followers_end: lastSnap?.followers_count ?? null,
      connections_start: firstSnap?.connections_count ?? null,
      connections_end: lastSnap?.connections_count ?? null,
      current_connections: currentConnections ?? 0,
    },
    requests: {
      total_sent: totalSent,
      accepted,
      withdrawn,
      acceptance_rate: totalSent > 0 ? accepted / totalSent : 0,
    },
    prospects: {
      new_from_competitors: newProspectsFromCompetitors ?? 0,
    },
  });
}
