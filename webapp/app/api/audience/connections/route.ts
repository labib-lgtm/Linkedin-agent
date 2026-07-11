import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { applyAudienceFilter, parseAudienceFilterFromSearchParams } from "@/lib/audience-filters";

export const dynamic = "force-dynamic";

// GET /api/audience/connections?country=&industry=&role_contains=&limit=500
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 500, 1), 2000);
  const filter = parseAudienceFilterFromSearchParams(sp);

  let q = supabase
    .from("audience_connections")
    .select("id, provider_id, public_identifier, full_name, headline, location, city, country, industry, current_company, current_role, profile_url, last_scanned_at")
    .eq("account_id", accountId)
    .order("full_name", { ascending: true, nullsFirst: false })
    .limit(limit);
  q = applyAudienceFilter(q, filter);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Head-count for the total (unfiltered) for the top-of-tab stat
  const { count: totalCount } = await supabase
    .from("audience_connections")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  return NextResponse.json({ rows: data ?? [], total: totalCount ?? 0 });
}
