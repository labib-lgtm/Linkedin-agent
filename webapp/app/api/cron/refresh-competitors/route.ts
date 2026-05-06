import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchUserPosts, normalizePost, UnipileError } from "@/lib/unipile";
import { isAuthorizedCron } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // give the daily refresh up to 5 min

type CompetitorRow = {
  id: string;
  identifier: string;
  active: boolean;
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
  const { data: comps, error } = await supabase
    .from("competitors")
    .select("id, identifier, active")
    .eq("active", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: Array<{ id: string; ok: boolean; fetched?: number; error?: string }> = [];
  for (const c of (comps as CompetitorRow[] | null) ?? []) {
    try {
      const raw = await fetchUserPosts(c.identifier, { maxPosts: 100, pageSize: 50 });
      const rows = raw.map(normalizePost).map((p) => ({
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

  return NextResponse.json({ refreshed: results });
}
