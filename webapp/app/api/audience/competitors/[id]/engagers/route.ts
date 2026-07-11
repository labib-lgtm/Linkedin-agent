import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/audience/competitors/[id]/engagers?segment_id=<uuid>&limit=200
//
// Lists engagers we've mined for a specific competitor. When segment_id
// is passed, filters to rows whose matched_segment_ids contains it.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: competitorId } = await params;
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const sp = req.nextUrl.searchParams;
  const segmentId = sp.get("segment_id");
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 200, 1), 1000);

  let q = supabase
    .from("competitor_engagers")
    .select("id, provider_id, full_name, headline, location, industry, current_company, job_title, profile_url, signal_type, matched_segment_ids, first_seen_at, last_seen_at")
    .eq("account_id", accountId)
    .eq("competitor_id", competitorId)
    .order("last_seen_at", { ascending: false })
    .limit(limit);
  if (segmentId) {
    q = q.contains("matched_segment_ids", [segmentId]);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ engagers: data ?? [] });
}
