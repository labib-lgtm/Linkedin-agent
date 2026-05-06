import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { identifierFromProfileUrl, resolveProviderId, UnipileError } from "@/lib/unipile";
import { getActiveAccountId } from "@/lib/active-account";

export const dynamic = "force-dynamic";
// Add does the Unipile lookup so analyze can skip it. Lookup ~5s + DB
// insert ~0.5s → fits under Hobby's 10s ceiling.
export const maxDuration = 10;

const ROLES = new Set(["direct", "format_source", "topic_source"]);

export async function GET() {
  const accountId = await getActiveAccountId();
  const supabase = createServiceClient();
  // Pull each competitor with its post count + best score so the list view
  // can render summary stats without N+1 queries. Scoped to the active
  // account so each Book entry shows only its own peer set.
  const { data: competitors, error } = await supabase
    .from("competitors")
    .select("*")
    .eq("account_id", accountId)
    .order("added_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (competitors ?? []).map((c) => c.id);
  let stats: Record<string, { count: number; topScore: number }> = {};
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
      {
        error: "invalid_profile_url",
        message: `Could not parse a LinkedIn handle from "${url}". Expected linkedin.com/in/<handle>, a bare slug, or an ACo... id.`,
      },
      { status: 400 },
    );
  }

  const role = body.role && ROLES.has(body.role) ? body.role : "direct";

  // Resolve the Unipile provider_id now so subsequent analyze clicks
  // don't have to re-do the slow lookup. This also validates the profile
  // is reachable before we save a useless row.
  let providerId: string | null = null;
  try {
    const resolved = await resolveProviderId(identifier);
    providerId = resolved.providerId;
  } catch (e) {
    if (e instanceof UnipileError) {
      return NextResponse.json(
        {
          error: "lookup_failed",
          message: `Could not resolve LinkedIn profile via Unipile: ${e.message}`,
          body: e.body,
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "lookup_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  const supabase = createServiceClient();
  const accountId = await getActiveAccountId();
  const { data, error } = await supabase
    .from("competitors")
    .insert({
      profile_url: url,
      identifier,
      provider_id: providerId,
      display_name: body.display_name?.trim() || null,
      role,
      notes: body.notes?.trim() || null,
      account_id: accountId,
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
