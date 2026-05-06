import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  aggregateCompetitor,
  type AggregatePost,
  type CompetitorAggregate,
} from "@/lib/competitor-aggregate";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return NextResponse.json({ competitors: [] });
  }

  const supabase = createServiceClient();

  const [{ data: competitorsData, error: cErr }, { data: postsData, error: pErr }] = await Promise.all([
    supabase
      .from("competitors")
      .select("id, identifier, display_name, role, last_analyzed_at")
      .in("id", ids),
    supabase
      .from("competitor_posts")
      .select(
        "competitor_id, post_id, posted_at, reactions, comments, reposts, engagement_score, text, media_type, media_urls",
      )
      .in("competitor_id", ids)
      .order("posted_at", { ascending: false }),
  ]);

  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const postsByCompetitor: Record<string, AggregatePost[]> = {};
  for (const row of (postsData as AggregatePost[] | null) ?? []) {
    const id = row.competitor_id;
    if (!postsByCompetitor[id]) postsByCompetitor[id] = [];
    postsByCompetitor[id].push(row);
  }

  // Preserve the requested order so the UI palette stays stable across
  // checkbox toggles in the same session.
  const competitorsMeta = (competitorsData ?? []) as Array<{
    id: string;
    identifier: string;
    display_name: string | null;
    role: string;
    last_analyzed_at: string | null;
  }>;
  const orderedMeta = ids
    .map((id) => competitorsMeta.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));

  const aggregates: CompetitorAggregate[] = orderedMeta.map((meta) =>
    aggregateCompetitor(meta, postsByCompetitor[meta.id] ?? []),
  );

  return NextResponse.json({ competitors: aggregates });
}
