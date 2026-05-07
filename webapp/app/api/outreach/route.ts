import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

// GET /api/outreach
//
// Returns the Outreach queue payload:
//   - candidates: top 20 competitor posts in last 14d not yet drafted
//   - drafts: outbound_comments for the active account, all statuses
//
// Used by /outreach page.
export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();

  const [{ data: drafts }, { data: posts }] = await Promise.all([
    supabase
      .from("outbound_comments")
      .select("*")
      .eq("account_id", accountId)
      .order("generated_at", { ascending: false })
      .limit(50),
    supabase
      .from("competitor_posts")
      .select("post_id, competitor_id, posted_at, text, engagement_score, media_type")
      .eq("account_id", accountId)
      .gte("posted_at", since)
      .order("engagement_score", { ascending: false })
      .limit(40),
  ]);

  const draftedPostIds = new Set((drafts ?? []).map((d) => d.competitor_post_id as string));
  const candidates = (posts ?? [])
    .filter((p) => !draftedPostIds.has(p.post_id as string))
    .slice(0, 20);

  // Resolve competitor names for both candidates and drafts.
  const competitorIds = new Set<string>();
  for (const c of candidates) {
    if (c.competitor_id) competitorIds.add(c.competitor_id as string);
  }
  for (const d of drafts ?? []) {
    if (d.competitor_id) competitorIds.add(d.competitor_id as string);
  }
  const names: Record<string, string> = {};
  if (competitorIds.size > 0) {
    const { data: comps } = await supabase
      .from("competitors")
      .select("id, identifier, display_name")
      .in("id", [...competitorIds]);
    for (const c of comps ?? []) {
      names[c.id as string] =
        (c.display_name as string) || (c.identifier as string) || "Unknown";
    }
  }

  return NextResponse.json({
    account_id: accountId,
    candidates: candidates.map((p) => ({
      ...p,
      competitor_name: p.competitor_id ? names[p.competitor_id as string] ?? "Unknown" : "Unknown",
    })),
    drafts: (drafts ?? []).map((d) => ({
      ...d,
      competitor_name: d.competitor_id ? names[d.competitor_id as string] ?? "Unknown" : "Unknown",
    })),
  });
}
