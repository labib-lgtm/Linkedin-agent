import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import {
  applySellerFilter,
  parseFilterFromSearchParams,
} from "@/lib/apollo-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// GET /api/outreach/apollo/prospects?...filters&limit=...&offset=...
//
// Lists the enriched apollo_prospects table joined to sellers, filtered by
// the same SellerFilter shape as preview / enrich / export. Returns the
// bundled prospect rows (person + company LinkedIn + Amazon storefront +
// originating Amazon context) for the Outreach → Apollo prospects tab.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const filter = parseFilterFromSearchParams(req.nextUrl.searchParams);
  const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit")) || 200, 1000));
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset")) || 0);

  // First, narrow sellers by the filter (paginated read).
  const PAGE = 1000;
  const matchingIds: string[] = [];
  let so = 0;
  while (true) {
    let q = supabase
      .from("sellers")
      .select("id")
      .eq("account_id", accountId)
      .range(so, so + PAGE - 1);
    q = applySellerFilter(q, filter);
    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    for (const r of rows) matchingIds.push(r.id as string);
    if (rows.length < PAGE) break;
    so += PAGE;
    if (so > 50_000) break;
  }

  if (filter.exclude_enrolled) {
    const enrolled = await fetchEnrolledSellerIds(supabase);
    for (let i = matchingIds.length - 1; i >= 0; i--) {
      if (enrolled.has(matchingIds[i])) matchingIds.splice(i, 1);
    }
  }

  if (matchingIds.length === 0) {
    return NextResponse.json({ rows: [], total: 0 });
  }

  // Now fetch apollo_prospects WHERE seller_id IN (...) — chunked to avoid
  // the PostgREST URL-length cliff at ~16KB.
  const CHUNK = 250;
  const all: any[] = [];
  for (let i = 0; i < matchingIds.length; i += CHUNK) {
    const chunk = matchingIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("apollo_prospects")
      .select(
        "id, seller_id, name, title, email, email_status, phone, linkedin_profile_url, " +
          "company_linkedin_url, amazon_storefront_url, city, state, country, enriched_at, " +
          "seller:sellers(brand_name, business_name, category, est_monthly_revenue, growth_3mo, num_asins)",
      )
      .in("seller_id", chunk)
      .eq("account_id", accountId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (data) all.push(...data);
  }

  // Sort by enriched_at desc (most recent first) and paginate in-memory.
  all.sort((a, b) => (a.enriched_at > b.enriched_at ? -1 : 1));
  const page = all.slice(offset, offset + limit);

  return NextResponse.json({ rows: page, total: all.length });
}

async function fetchEnrolledSellerIds(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("prospects")
      .select("seller_id")
      .not("seller_id", "is", null)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = data ?? [];
    for (const r of rows) {
      if (r.seller_id) ids.add(r.seller_id as string);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
    if (offset > 50_000) break;
  }
  return ids;
}
