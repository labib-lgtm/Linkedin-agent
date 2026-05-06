import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchUserPosts, normalizePost, UnipileError } from "@/lib/unipile";
import { isAuthorizedCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
// Hobby plan caps functions at 10s. Per-competitor budget is ~5s, so this
// invocation will refresh whichever competitor is most-overdue and stop
// before Vercel kills it. Across daily invocations, the whole list cycles.
export const maxDuration = 10;

type CompetitorRow = {
  id: string;
  identifier: string;
  provider_id: string | null;
  active: boolean;
  last_analyzed_at: string | null;
};

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runRefresh();
}

// Manual POST for ad-hoc invocation (also cron-secret gated).
export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return runRefresh();
}

async function runRefresh() {
  const supabase = createServiceClient();
  // Pull most-stale-first (NULL last_analyzed_at counts as oldest) so each
  // daily cron picks up the competitor that's most overdue. Across
  // invocations the whole roster cycles.
  const { data: comps, error } = await supabase
    .from("competitors")
    .select("id, identifier, provider_id, active, last_analyzed_at")
    .eq("active", true)
    .order("last_analyzed_at", { ascending: true, nullsFirst: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const start = Date.now();
  const BUDGET_MS = 8_500; // leave ~1.5s headroom under Hobby's 10s cap
  const results: Array<{ id: string; ok: boolean; fetched?: number; error?: string }> = [];
  const skipped: string[] = [];

  for (const c of (comps as CompetitorRow[] | null) ?? []) {
    if (Date.now() - start > BUDGET_MS) {
      skipped.push(c.id);
      continue;
    }
    try {
      const result = await fetchUserPosts(c.identifier, {
        maxPosts: 30,
        pageSize: 30,
        providerId: c.provider_id || undefined,
      });
      const raw = result.posts;
      if (!c.provider_id && result.providerId) {
        await supabase
          .from("competitors")
          .update({ provider_id: result.providerId })
          .eq("id", c.id);
      }
      // Dedupe: Unipile sometimes returns the same post_id twice; the
      // upsert refuses a batch that hits the same conflict target twice.
      const byPostId = new Map<string, ReturnType<typeof normalizePost>>();
      for (const p of raw.map(normalizePost)) byPostId.set(p.post_id, p);
      const rows = [...byPostId.values()].map((p) => ({
        competitor_id: c.id,
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
        const { error: upErr } = await supabase
          .from("competitor_posts")
          .upsert(rows, { onConflict: "competitor_id,post_id" });
        if (upErr) throw new Error(upErr.message);
      }
      await supabase
        .from("competitors")
        .update({ last_analyzed_at: new Date().toISOString() })
        .eq("id", c.id);
      results.push({ id: c.id, ok: true, fetched: rows.length });
    } catch (e) {
      const msg = e instanceof UnipileError ? `${e.status}: ${e.body.slice(0, 200)}` : (e as Error).message;
      results.push({ id: c.id, ok: false, error: msg });
    }
  }

  return NextResponse.json({ refreshed: results, skipped, took_ms: Date.now() - start });
}
