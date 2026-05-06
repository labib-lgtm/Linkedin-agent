import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { identifierFromProfileUrl } from "@/lib/unipile";

export const dynamic = "force-dynamic";

const ROLES = new Set(["direct", "format_source", "topic_source"]);

export async function GET() {
  const supabase = createServiceClient();
  // Pull each competitor with its post count + best score so the list view
  // can render summary stats without N+1 queries.
  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("*")
    .order("added_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (competitors ?? []).map((c) => c.id);
  let stats: Record<string, { count: number; topScore: number }> = {};
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

  return NextResponse.json({
    competitors: (competitors ?? []).map((c) => ({
      ...c,
      post_count: stats[c.id]?.count ?? 0,
      top_score: stats[c.id]?.topScore ?? 0,
    })),
  });
}

export async function POST(req: NextRequest) {
  let body: {
    profile_url?: string;
    display_name?: string;
    role?: string;
    notes?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const url = String(body.profile_url ?? "").trim();
  const identifier = identifierFromProfileUrl(url);
  if (!identifier) {
    return NextResponse.json(
      { error: "invalid_profile_url", message: "Expected linkedin.com/in/<handle>" },
      { status: 400 },
    );
  }

  const role = body.role && ROLES.has(body.role) ? body.role : "direct";

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("competitors")
    .insert({
      profile_url: url,
      identifier,
      display_name: body.display_name?.trim() || null,
      role,
      notes: body.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "already_tracked", message: `${identifier} is already tracked` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ competitor: data });
}
