import { createServiceClient } from "@/lib/supabase/server";
import { AddCompetitorForm } from "./AddCompetitorForm";
import { CompetitorRow } from "./CompetitorRow";

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

  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("*")
    .order("added_at", { ascending: false });

  // Pull stats in one extra query so the row component doesn't N+1.
  const ids = (competitors ?? []).map((c: CompetitorRowData) => c.id);
  const stats: Record<string, { count: number; topScore: number }> = {};
  if (ids.length > 0) {
    const { data: posts } = await supabase
      .from("competitor_posts")
      .select("competitor_id, engagement_score")
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

      <AddCompetitorForm />

      {error ? (
        <p className="text-sm text-red-700">Failed to load: {error.message}</p>
      ) : (competitors ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No competitors yet. Paste a LinkedIn profile URL above to start tracking.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-3 px-3 font-semibold">Creator</th>
                <th className="py-3 px-3 font-semibold">Role</th>
                <th className="py-3 px-3 font-semibold">Posts</th>
                <th className="py-3 px-3 font-semibold">Top score</th>
                <th className="py-3 px-3 font-semibold">Last analyzed</th>
                <th className="py-3 px-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(competitors ?? []).map((c: CompetitorRowData) => (
                <CompetitorRow
                  key={c.id}
                  competitor={{
                    ...c,
                    post_count: stats[c.id]?.count ?? 0,
                    top_score: stats[c.id]?.topScore ?? 0,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
