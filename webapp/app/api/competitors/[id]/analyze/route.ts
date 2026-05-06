import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchUserPosts, normalizePost, scorePost, UnipileError } from "@/lib/unipile";

export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 10s. Stay well under so a slow Unipile
// page doesn't tip us over and return an empty body.
export const maxDuration = 10;

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = createServiceClient();

  const { data: competitor, error: cErr } = await supabase
    .from("competitors")
    .select("*")
    .eq("id", id)
    .single();
  if (cErr || !competitor) {
    return NextResponse.json({ error: cErr?.message ?? "not_found" }, { status: 404 });
  }

  let raw;
  try {
    // 1 page of 50 posts → fits inside the Hobby 10s budget after the
    // resolveProviderId lookup (~2s) and DB upsert (~0.5s). The daily cron
    // tops up successive pages over multiple days.
    raw = await fetchUserPosts(competitor.identifier, { maxPosts: 50, pageSize: 50 });
  } catch (e) {
    if (e instanceof UnipileError) {
      return NextResponse.json(
        { error: "unipile_failed", status: e.status, body: e.body },
        { status: e.status === 400 ? 400 : 502 },
      );
    }
    return NextResponse.json(
      { error: "fetch_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  const normalized = raw.map(normalizePost);
  const rows = normalized.map((p) => ({
    competitor_id: id,
    post_id: p.post_id,
    posted_at: p.posted_at,
    text: p.text,
    reactions: p.reactions,
    comments: p.comments,
    reposts: p.reposts,
    raw: p.raw,
    fetched_at: new Date().toISOString(),
  }));

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("competitor_posts")
      .upsert(rows, { onConflict: "competitor_id,post_id" });
    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }
  }

  await supabase
    .from("competitors")
    .update({ last_analyzed_at: new Date().toISOString() })
    .eq("id", id);

  const top = [...normalized]
    .sort((a, b) => scorePost(b) - scorePost(a))
    .slice(0, 10)
    .map((p) => ({
      post_id: p.post_id,
      posted_at: p.posted_at,
      reactions: p.reactions,
      comments: p.comments,
      reposts: p.reposts,
      score: scorePost(p),
      excerpt: (p.text ?? "").slice(0, 140),
    }));

  return NextResponse.json({ fetched: rows.length, top });
}
