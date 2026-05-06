import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  fetchUserPosts,
  normalizePost,
  resolveProviderId,
  scorePost,
  UnipileError,
} from "@/lib/unipile";

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

  // First call for a competitor with no cached provider_id: do the Unipile
  // lookup and persist it before the post fetch so even if subsequent
  // steps fail, the next click skips the slow lookup.
  let providerId = competitor.provider_id as string | null;
  if (!providerId) {
    try {
      const resolved = await resolveProviderId(competitor.identifier);
      providerId = resolved.providerId;
      const { error: updErr } = await supabase
        .from("competitors")
        .update({ provider_id: providerId })
        .eq("id", id);
      if (updErr) {
        console.error("[analyze] cache provider_id failed", updErr);
        return NextResponse.json(
          { error: "cache_failed", message: updErr.message },
          { status: 500 },
        );
      }
    } catch (e) {
      if (e instanceof UnipileError) {
        return NextResponse.json(
          { error: "lookup_failed", status: e.status, body: e.body },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: "lookup_failed", message: (e as Error).message },
        { status: 502 },
      );
    }
  }

  let raw;
  try {
    // provider_id is cached now → just one paginated post fetch, ~3s.
    // 30 posts per click; click again to backfill, upserts dedupe.
    const result = await fetchUserPosts(competitor.identifier, {
      maxPosts: 30,
      pageSize: 30,
      providerId,
    });
    raw = result.posts;
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

  // Wrap normalize + upsert in a try so any synchronous throw (e.g. JSON
  // serialization issue with raw payloads, or supabase client crash on a
  // bad cell) returns a JSON error instead of an empty 500.
  try {
    const normalized = raw.map(normalizePost);
    // Unipile occasionally returns the same post_id twice in one page
    // (reshares, sometimes quirks of pagination). Postgres rejects an
    // upsert batch where two rows hit the same conflict target with
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"
    // — keep only the last occurrence of each post_id.
    const byPostId = new Map<string, ReturnType<typeof normalizePost>>();
    for (const p of normalized) byPostId.set(p.post_id, p);
    const dedup = [...byPostId.values()];

    const rows = dedup.map((p) => ({
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
        console.error("[analyze] upsert posts failed", upsertErr);
        return NextResponse.json(
          {
            error: "upsert_failed",
            message: upsertErr.message,
            details: upsertErr.details ?? null,
            hint: upsertErr.hint ?? null,
            code: upsertErr.code ?? null,
          },
          { status: 500 },
        );
      }
    }

    await supabase
      .from("competitors")
      .update({ last_analyzed_at: new Date().toISOString() })
      .eq("id", id);

    return await respondWithTop(dedup, rows.length);
  } catch (e) {
    console.error("[analyze] post-fetch processing crashed", e);
    return NextResponse.json(
      { error: "processing_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}

async function respondWithTop(
  normalized: ReturnType<typeof normalizePost>[],
  fetchedCount: number,
) {

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

  return NextResponse.json({ fetched: fetchedCount, top });
}
