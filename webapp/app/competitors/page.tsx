import { createServiceClient } from "@/lib/supabase/server";
import { CompetitorsView } from "./CompetitorsView";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";

type CompetitorRowData = {
  id: string;
  profile_url: string;
  identifier: string;
  display_name: string | null;
  role: string;
  active: boolean;
  notes: string | null;
  added_at: string;
  last_analyzed_at: string | null;
};

export default async function CompetitorsPage() {
  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("*")
    .eq("account_id", accountId)
    .order("added_at", { ascending: false });

  // Pull stats in one extra query so the row component doesn't N+1.
  const ids = (competitors ?? []).map((c: CompetitorRowData) => c.id);
  const stats: Record<string, { count: number; topScore: number }> = {};
  if (ids.length > 0) {
    const { data: posts } = await supabase
      .from("competitor_posts")
      .select("competitor_id, engagement_score")
      .eq("account_id", accountId)
      .in("competitor_id", ids);
    for (const row of posts ?? []) {
      const id = row.competitor_id as string;
      const score = Number(row.engagement_score ?? 0);
      const cur = stats[id] ?? { count: 0, topScore: 0 };
      cur.count += 1;
      if (score > cur.topScore) cur.topScore = score;
      stats[id] = cur;
    }
  }

  const enriched = (competitors ?? []).map((c: CompetitorRowData) => ({
    ...c,
    post_count: stats[c.id]?.count ?? 0,
    top_score: stats[c.id]?.topScore ?? 0,
  }));

  return (
    <div className="container-tight py-6 sm:py-8 space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight">
          Competitors
        </h1>
        <p className="text-xs text-muted-foreground">
          {competitors?.length ?? 0} tracked
        </p>
      </div>
      <CompetitorsView competitors={enriched} loadError={error?.message ?? null} />
    </div>
  );
}
