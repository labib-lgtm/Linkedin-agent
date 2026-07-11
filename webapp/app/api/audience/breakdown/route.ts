import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";
import { bucketSeniority, seniorityLabel, type SeniorityBucket } from "@/lib/seniority";

export const dynamic = "force-dynamic";

// GET /api/audience/breakdown?source=connections|followers
// Returns top-10 by country, top-10 by industry, top-8 by seniority.
// Seniority isn't stored explicitly — bucketed in-app from job_title +
// headline via the seniority keyword mapper.
export async function GET(req: NextRequest) {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const source = (req.nextUrl.searchParams.get("source") ?? "connections") === "followers"
    ? "audience_followers"
    : "audience_connections";

  // Head-count for the total is the denominator for the % column
  const { count: totalCount } = await supabase
    .from(source)
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId);

  // Paginated fetch of just the columns we need for aggregation. The
  // combined connections table isn't huge (thousands, not millions) so a
  // one-shot pull with generous cap is cheaper than a GROUP BY round-trip.
  const rows: Array<{ country: string | null; industry: string | null; job_title: string | null; headline: string | null }> = [];
  const PAGE = 1000;
  let offset = 0;
  while (offset < 20_000) {
    const { data, error } = await supabase
      .from(source)
      .select("country, industry, job_title, headline")
      .eq("account_id", accountId)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = data ?? [];
    for (const r of batch) {
      rows.push({
        country: (r.country as string | null) ?? null,
        industry: (r.industry as string | null) ?? null,
        job_title: (r.job_title as string | null) ?? null,
        headline: (r.headline as string | null) ?? null,
      });
    }
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  const countryTally = tally(rows.map((r) => r.country));
  const industryTally = tally(rows.map((r) => r.industry));
  const seniorityTally = new Map<SeniorityBucket, number>();
  for (const r of rows) {
    const b = bucketSeniority(r.job_title, r.headline);
    seniorityTally.set(b, (seniorityTally.get(b) ?? 0) + 1);
  }

  return NextResponse.json({
    total: totalCount ?? 0,
    by_country: topN(countryTally, 10),
    by_industry: topN(industryTally, 10),
    by_seniority: [...seniorityTally.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([bucket, count]) => ({ label: seniorityLabel(bucket), key: bucket, count })),
  });
}

function tally(vals: Array<string | null>): Map<string, number> {
  const m = new Map<string, number>();
  for (const v of vals) {
    if (!v) continue;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
}

function topN(m: Map<string, number>, n: number): Array<{ label: string; count: number }> {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}
