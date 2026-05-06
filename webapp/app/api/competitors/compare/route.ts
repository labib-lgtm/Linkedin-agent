import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  aggregateCompetitor,
  type AggregatePost,
  type CompetitorAggregate,
} from "@/lib/competitor-aggregate";

export const dynamic = "force-dynamic";

// GET /api/competitors/compare?ids=uuid1,uuid2,...
//
// Phase 1 of Compare v2:
// - Always includes the is_self=true competitor in the result (even if not
//   in the requested ids), because the leaderboard pins it as the baseline.
// - Returns existing aggregates plus `recent_posts` (last 28 days raw)
//   so client-side helpers can compute breakouts, cadence cells, and
//   format mix without round-tripping back to Supabase.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const requested = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const supabase = createServiceClient();

  // Always pull the self competitor so the leaderboard has a baseline.
  const { data: selfRow, error: sErr } = await supabase
    .from("competitors")
    .select("id, identifier, display_name, role, last_analyzed_at, is_self")
    .eq("is_self", true)
    .maybeSingle();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // Effective id set: requested ∪ self (if any). Order preserved with self
  // first when not already in the request.
  const ids = Array.from(
    new Set([...(selfRow ? [selfRow.id] : []), ...requested]),
  );
  if (ids.length === 0) {
    return NextResponse.json({ competitors: [], self_id: null });
  }

  // Posts window: last 28 days, capped per competitor at 60. Tight enough to
  // fit Hobby's 10s ceiling at typical sizes (~300 rows) and aligned with
  // the cadence calendar's 28-cell horizon.
  const since = new Date(Date.now() - 28 * 86_400_000).toISOString();

  const [{ data: competitorsData, error: cErr }, { data: postsData, error: pErr }] = await Promise.all([
    supabase
      .from("competitors")
      .select("id, identifier, display_name, role, last_analyzed_at, is_self")
      .in("id", ids),
    supabase
      .from("competitor_posts")
      .select(
        "competitor_id, post_id, posted_at, reactions, comments, reposts, engagement_score, text, media_type, media_urls",
      )
      .in("competitor_id", ids)
      .gte("posted_at", since)
      .order("posted_at", { ascending: false }),
  ]);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  type CompetitorMeta = {
    id: string;
    identifier: string;
    display_name: string | null;
    role: string;
    last_analyzed_at: string | null;
    is_self: boolean | null;
  };

  // Cap to 60 posts per competitor (already date-filtered + score-ordered).
  const postsByCompetitor: Record<string, AggregatePost[]> = {};
  for (const row of (postsData as AggregatePost[] | null) ?? []) {
    const id = row.competitor_id;
    if (!postsByCompetitor[id]) postsByCompetitor[id] = [];
    if (postsByCompetitor[id].length < 60) postsByCompetitor[id].push(row);
  }

  // Self pinned first; rest preserve requested order.
  const metaById: Record<string, CompetitorMeta> = {};
  for (const m of (competitorsData ?? []) as CompetitorMeta[]) metaById[m.id] = m;
  const orderedIds = [
    ...(selfRow ? [selfRow.id] : []),
    ...requested.filter((id) => id !== selfRow?.id),
  ];
  const orderedMeta = orderedIds
    .map((id) => metaById[id])
    .filter((m): m is CompetitorMeta => Boolean(m));

  type CompareCompetitor = CompetitorAggregate & {
    is_self: boolean;
    recent_posts: AggregatePost[];
  };

  const competitors: CompareCompetitor[] = orderedMeta.map((meta) => {
    const posts = postsByCompetitor[meta.id] ?? [];
    return {
      ...aggregateCompetitor(meta, posts),
      is_self: !!meta.is_self,
      recent_posts: posts,
    };
  });

  return NextResponse.json({
    competitors,
    self_id: selfRow?.id ?? null,
  });
}
