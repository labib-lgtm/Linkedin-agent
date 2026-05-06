import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// GET /api/accounts/[id]/insights — Phase 4 surface.
// Returns the top hook patterns + themes (with leader competitor) for an
// account. Drives the HookPatternsPanel + ThemesPanel + InsightBanner
// card #1.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  const [{ data: hooks }, { data: themes }, { data: themePostCounts }] =
    await Promise.all([
      supabase
        .from("hook_patterns")
        .select("id, template, normalized_key, sample_count, avg_score")
        .eq("account_id", id)
        .order("avg_score", { ascending: false })
        .limit(8),
      supabase
        .from("themes")
        .select("id, name, llm_summary, post_count, avg_score, leader_competitor_id")
        .eq("account_id", id)
        .order("post_count", { ascending: false })
        .limit(12),
      // Theme leader needs competitor display_name. We resolve via a
      // second batched query.
      supabase
        .from("competitor_post_analysis")
        .select("theme_id, competitor_id")
        .eq("account_id", id)
        .not("theme_id", "is", null),
    ]);

  // Compute leader competitor per theme: the competitor with the most posts
  // in that theme. This is a rolling aggregate so we don't bother caching
  // it on the themes row.
  type LeaderRow = { theme_id: string; competitor_id: string };
  const counts: Record<string, Record<string, number>> = {};
  for (const r of (themePostCounts as LeaderRow[] | null) ?? []) {
    counts[r.theme_id] = counts[r.theme_id] ?? {};
    counts[r.theme_id][r.competitor_id] = (counts[r.theme_id][r.competitor_id] ?? 0) + 1;
  }
  const leaderCompetitorByTheme: Record<string, string | null> = {};
  for (const [themeId, byCompetitor] of Object.entries(counts)) {
    let bestId: string | null = null;
    let bestN = 0;
    for (const [cid, n] of Object.entries(byCompetitor)) {
      if (n > bestN) {
        bestN = n;
        bestId = cid;
      }
    }
    leaderCompetitorByTheme[themeId] = bestId;
  }

  const competitorIds = [...new Set(Object.values(leaderCompetitorByTheme).filter(Boolean) as string[])];
  let competitorNames: Record<string, string> = {};
  if (competitorIds.length > 0) {
    const { data: comps } = await supabase
      .from("competitors")
      .select("id, identifier, display_name")
      .in("id", competitorIds);
    for (const c of comps ?? []) {
      competitorNames[c.id as string] = (c.display_name as string) || (c.identifier as string);
    }
  }

  const themesEnriched = (themes ?? []).map((t) => ({
    ...t,
    leader_competitor_id: leaderCompetitorByTheme[t.id as string] ?? null,
    leader_name: competitorNames[leaderCompetitorByTheme[t.id as string] ?? ""] ?? null,
  }));

  return NextResponse.json({
    hook_patterns: hooks ?? [],
    themes: themesEnriched,
  });
}
