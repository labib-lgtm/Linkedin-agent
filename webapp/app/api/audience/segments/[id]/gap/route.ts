import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { applySegmentFilter, type SegmentDefinition } from "@/lib/audience-filters";

export const dynamic = "force-dynamic";

// GET /api/audience/segments/[id]/gap
//
// Returns { total_audience, matching_audience, gap } — the segment's
// filter applied against audience_connections. Weekly quota progress is
// computed here too so Tab 3 renders in one round-trip.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();

  const { data: seg, error: segErr } = await supabase
    .from("target_segments")
    .select("id, name, industries, role_keywords, locations, company_size_min, company_size_max, weekly_quota")
    .eq("account_id", accountId)
    .eq("id", id)
    .maybeSingle();
  if (segErr || !seg) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const definition: SegmentDefinition = {
    industries: (seg.industries as string[]) ?? [],
    role_keywords: (seg.role_keywords as string[]) ?? [],
    locations: (seg.locations as string[]) ?? [],
    company_size_min: seg.company_size_min as number | null,
    company_size_max: seg.company_size_max as number | null,
  };

  // Head-only counts to keep this cheap.
  const { count: totalAudience } = await supabase
    .from("audience_connections")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  let matchingQ = supabase
    .from("audience_connections")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  matchingQ = applySegmentFilter(matchingQ, definition);
  const { count: matchingAudience, error: matchErr } = await matchingQ;
  if (matchErr) return NextResponse.json({ error: matchErr.message }, { status: 500 });

  // Weekly quota progress: outgoing_invitations sent this ISO week for this segment.
  const weekStart = new Date();
  const day = weekStart.getUTCDay();
  const diffToMonday = (day + 6) % 7; // Mon = 0
  weekStart.setUTCDate(weekStart.getUTCDate() - diffToMonday);
  weekStart.setUTCHours(0, 0, 0, 0);

  const { count: sentThisWeek } = await supabase
    .from("outgoing_invitations")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("segment_id", id)
    .gte("sent_at", weekStart.toISOString());

  const quota = seg.weekly_quota as number;
  return NextResponse.json({
    segment: seg,
    total_audience: totalAudience ?? 0,
    matching_audience: matchingAudience ?? 0,
    gap: Math.max(0, (matchingAudience ?? 0) - 0),
    weekly_quota: quota,
    sent_this_week: sentThisWeek ?? 0,
    week_start: weekStart.toISOString(),
  });
}
