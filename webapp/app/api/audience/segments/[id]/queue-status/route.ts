import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/audience/segments/[id]/queue-status
//
// Returns the counters + 14-day acceptance rate + recent candidates that
// Tab 3's segment detail strip renders. Single round-trip so the tab
// doesn't fan out N queries per segment.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const nowIso = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const day14Ago = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const acctScope = supabase
    .from("outgoing_invitations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("segment_id", id);

  const countBy = async (
    status: string | null,
    since: string | null,
    field: "sent_at" | "accepted_at" = "sent_at",
  ): Promise<number> => {
    let q = supabase
      .from("outgoing_invitations")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .eq("segment_id", id);
    if (status) q = q.eq("status", status);
    if (since) q = q.gte(field, since);
    const { count } = await q;
    return count ?? 0;
  };

  const [
    sourcedToday,
    sentToday,
    acceptedToday,
    sent14d,
    accepted14d,
    totalSent,
    totalAccepted,
  ] = await Promise.all([
    (async () => {
      // "Sourced today" = created into outgoing_invitations today, any status.
      let q = supabase
        .from("outgoing_invitations")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId)
        .eq("segment_id", id)
        .gte("sent_at", dayAgo);
      const { count } = await q;
      return count ?? 0;
    })(),
    countBy(null, dayAgo, "sent_at"),
    countBy("accepted", dayAgo, "accepted_at"),
    countBy(null, day14Ago, "sent_at"),
    countBy("accepted", day14Ago, "sent_at"),
    (async () => {
      const { count } = await acctScope;
      return count ?? 0;
    })(),
    countBy("accepted", null),
  ]);

  const rate14d = sent14d > 0 ? accepted14d / sent14d : null;

  // Recent candidates — join is manual since PostgREST select-embeds are
  // finicky across FKs we may not have declared. Keep it small (last 20).
  const { data: recent } = await supabase
    .from("outgoing_invitations")
    .select("id, provider_id, full_name, headline, status, sent_at, accepted_at")
    .eq("account_id", accountId)
    .eq("segment_id", id)
    .order("sent_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    counters: {
      sourced_today: sourcedToday,
      sent_today: sentToday,
      accepted_today: acceptedToday,
      sent_14d: sent14d,
      accepted_14d: accepted14d,
      total_sent: totalSent,
      total_accepted: totalAccepted,
    },
    rate_14d: rate14d,
    recent: recent ?? [],
    now: nowIso,
  });
}
