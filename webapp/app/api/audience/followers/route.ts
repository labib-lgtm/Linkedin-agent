import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { applyAudienceFilter, parseAudienceFilterFromSearchParams } from "@/lib/audience-filters";

export const dynamic = "force-dynamic";

// GET /api/audience/followers — paginated list of discovered followers.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 500, 1), 2000);
  const filter = parseAudienceFilterFromSearchParams(sp);

  let q = supabase
    .from("audience_followers")
    .select("id, provider_id, public_identifier, full_name, headline, location, city, country, industry, current_company, job_title, profile_url, discovered_at")
    .eq("account_id", accountId)
    .order("discovered_at", { ascending: false })
    .limit(limit);
  q = applyAudienceFilter(q, filter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { count: totalCount } = await supabase
    .from("audience_followers")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  return NextResponse.json({ rows: data ?? [], discovered: totalCount ?? 0 });
}
