import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import {
  applySellerFilter,
  parseFilterFromSearchParams,
} from "@/lib/apollo-filters";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/outreach/apollo/export.csv?...filters
//
// Streams a CSV of the enriched apollo_prospects table joined to sellers,
// shaped for Meta Custom Audience upload.
//
// Leading columns match Meta's spec (email, phone, fn, ln, ct, st, country).
// Trailing columns are Lynx context for joining back to the originating
// seller after Meta enrichment — Meta ignores unknown columns at upload.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const filter = parseFilterFromSearchParams(req.nextUrl.searchParams);

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

  const rows: any[] = [];
  if (matchingIds.length > 0) {
    const CHUNK = 250;
    for (let i = 0; i < matchingIds.length; i += CHUNK) {
      const chunk = matchingIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("apollo_prospects")
        .select(
          "name, first_name, last_name, title, email, phone, linkedin_profile_url, " +
            "company_linkedin_url, amazon_storefront_url, city, state, country, enriched_at, " +
            "seller:sellers(brand_name, business_name, category, est_monthly_revenue, growth_3mo, num_asins)",
        )
        .in("seller_id", chunk)
        .eq("account_id", accountId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (data) rows.push(...data);
    }
  }

  const csvEsc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  // Meta Custom Audience leading columns first, then context columns.
  const HEADER = [
    "email",
    "phone",
    "fn",
    "ln",
    "ct",
    "st",
    "country",
    "company_linkedin_url",
    "amazon_storefront_url",
    "linkedin_profile_url",
    "title",
    "lynx_brand",
    "lynx_business",
    "lynx_category",
    "lynx_est_monthly_revenue_usd",
    "lynx_growth_3mo_percent",
    "lynx_num_asins",
    "lynx_enriched_at",
  ];

  const lines = [HEADER.join(",")];
  for (const r of rows) {
    const seller = r.seller && (Array.isArray(r.seller) ? r.seller[0] : r.seller);
    lines.push(
      [
        r.email,
        r.phone,
        r.first_name,
        r.last_name,
        r.city,
        r.state,
        r.country,
        r.company_linkedin_url,
        r.amazon_storefront_url,
        r.linkedin_profile_url,
        r.title,
        seller?.brand_name,
        seller?.business_name,
        seller?.category,
        seller?.est_monthly_revenue,
        seller?.growth_3mo,
        seller?.num_asins,
        r.enriched_at,
      ]
        .map(csvEsc)
        .join(","),
    );
  }

  const csv = lines.join("\n");
  const filename = `apollo_prospects_${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
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
