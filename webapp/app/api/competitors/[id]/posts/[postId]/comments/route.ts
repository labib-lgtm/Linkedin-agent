import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchPostComments, UnipileError } from "@/lib/unipile";

export const dynamic = "force-dynamic";
// Single Unipile call with 8s timeout, plus a small Supabase round-trip
// for the cache check. 30s leaves ample headroom on Vercel Pro for
// retry/backoff if Unipile is slow.
export const maxDuration = 30;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; postId: string }> },
) {
  const { id, postId } = await ctx.params;
  const supabase = createServiceClient();

  // Decode the postId — URLs encode urn:li:activity:... as urn%3Ali%3Aactivity%3A...
  const decodedPostId = decodeURIComponent(postId);

  const { data: row, error: fetchErr } = await supabase
    .from("competitor_posts")
    .select("id, comments_data, comments_fetched_at")
    .eq("competitor_id", id)
    .eq("post_id", decodedPostId)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "post_not_found", message: "Post not in competitor_posts" },
      { status: 404 },
    );
  }

  const cacheAge =
    row.comments_fetched_at
      ? Date.now() - new Date(row.comments_fetched_at).getTime()
      : Infinity;

  if (Array.isArray(row.comments_data) && cacheAge < CACHE_TTL_MS) {
    return NextResponse.json({
      cached: true,
      fetched_at: row.comments_fetched_at,
      comments: row.comments_data,
    });
  }

  let comments;
  try {
    comments = await fetchPostComments(decodedPostId, { maxComments: 50, pageSize: 50 });
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

  const fetched_at = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("competitor_posts")
    .update({ comments_data: comments, comments_fetched_at: fetched_at })
    .eq("id", row.id);

  if (updateErr) {
    // Best-effort cache write — return the comments anyway so the user still sees them.
    console.error("[comments] cache write failed", updateErr);
  }

  return NextResponse.json({ cached: false, fetched_at, comments });
}
