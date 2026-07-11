import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/audience/requests?status=pending&limit=500
// Also returns aggregated month-to-date rollup + auto-flagged stale count
// so Tab 2 can render the top strip and highlighted rows in one round-trip.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const status = (req.nextUrl.searchParams.get("status") ?? "all").toLowerCase();
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 500, 1), 2000);

  let q = supabase
    .from("outgoing_invitations")
    .select("id, provider_id, full_name, headline, note, status, sent_at, accepted_at, withdrawn_at, withdraw_reason")
    .eq("account_id", accountId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (status !== "all") q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Monthly rollup
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();

  const { data: monthRows } = await supabase
    .from("outgoing_invitations")
    .select("status, sent_at, accepted_at")
    .eq("account_id", accountId)
    .gte("sent_at", monthIso);

  const rollup = summarizeMonth(monthRows ?? []);

  // Totals per status for the pill counts
  const totals: Record<string, number> = {};
  for (const s of ["sent", "pending", "accepted", "withdrawn", "expired"]) {
    const { count } = await supabase
      .from("outgoing_invitations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("status", s);
    totals[s] = count ?? 0;
  }

  return NextResponse.json({ rows: data ?? [], rollup, totals });
}

interface MonthRow {
  status: string;
  sent_at: string;
  accepted_at: string | null;
}

function summarizeMonth(rows: MonthRow[]) {
  const sent = rows.length;
  const accepted = rows.filter((r) => r.status === "accepted").length;
  const withdrawn = rows.filter((r) => r.status === "withdrawn").length;
  const acceptDurations = rows
    .filter((r) => r.status === "accepted" && r.accepted_at)
    .map((r) => new Date(r.accepted_at as string).getTime() - new Date(r.sent_at).getTime())
    .filter((n) => Number.isFinite(n) && n >= 0);
  const avgTimeToAcceptMs = acceptDurations.length
    ? acceptDurations.reduce((a, b) => a + b, 0) / acceptDurations.length
    : null;
  return {
    total_sent: sent,
    accepted,
    withdrawn,
    acceptance_rate: sent > 0 ? accepted / sent : 0,
    avg_time_to_accept_hours: avgTimeToAcceptMs != null ? avgTimeToAcceptMs / (1000 * 60 * 60) : null,
  };
}
