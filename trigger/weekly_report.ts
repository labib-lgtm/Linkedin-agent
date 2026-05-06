import { logger, schedules } from "@trigger.dev/sdk/v3";
import { createClient } from "@supabase/supabase-js";

/**
 * Weekly client report — Phase 5 of Compare v2.
 *
 * For every non-archived account, builds a one-pager covering:
 *   - Top 3 changes (profile_change_events, last 7d)
 *   - Top 3 breakout posts (>= 3x author 90d median, last 7d)
 *   - Top 3 recommended hooks (hook_patterns, top by avg_score)
 *
 * The payload JSONB is stored in client_reports + a 16-char share_token
 * is auto-generated so the public /reports/[token] page renders without
 * the PIN gate. Lynx can copy that link and send to the client.
 *
 * Schedule: Monday 9am UTC (after digest at 8am UTC).
 */

const BREAKOUT_MULTIPLIER = 3;

type Account = {
  id: string;
  name: string;
  brand_color: string | null;
  logo_url: string | null;
};

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE creds missing");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isoWeekStart(d: Date): string {
  // Monday 00:00 UTC of the week containing d.
  const day = d.getUTCDay();        // 0 (Sun) .. 6 (Sat)
  const diff = (day + 6) % 7;       // days back to Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

async function buildReportPayload(
  client: ReturnType<typeof supabase>,
  account: Account,
): Promise<unknown> {
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since90 = new Date(Date.now() - 90 * 86_400_000).toISOString();

  // 1. Top 3 changes (last 7d).
  const { data: changes } = await client
    .from("profile_change_events")
    .select("competitor_id, kind, before_value, after_value, detected_at")
    .eq("account_id", account.id)
    .gte("detected_at", since7)
    .order("detected_at", { ascending: false })
    .limit(3);

  const competitorIds = new Set<string>();
  for (const c of changes ?? []) competitorIds.add(c.competitor_id as string);

  // 2. Top 3 breakouts (last 7d). Need to compute per-author 90d median
  // first, then filter recent posts by score >= 3*median.
  const { data: posts90 } = await client
    .from("competitor_posts")
    .select("competitor_id, post_id, posted_at, text, engagement_score, media_type")
    .eq("account_id", account.id)
    .gte("posted_at", since90);

  type PostRow = {
    competitor_id: string;
    post_id: string;
    posted_at: string | null;
    text: string | null;
    engagement_score: number | string | null;
    media_type: string | null;
  };
  const byCompetitor: Record<string, Array<{ score: number; row: PostRow }>> = {};
  for (const p of (posts90 as PostRow[] | null) ?? []) {
    const cid = p.competitor_id;
    const score = Number(p.engagement_score ?? 0) || 0;
    if (!byCompetitor[cid]) byCompetitor[cid] = [];
    byCompetitor[cid].push({ score, row: p });
  }
  const breakouts: Array<{
    competitor_id: string;
    post_id: string;
    posted_at: string;
    score: number;
    multiplier: number;
    text_excerpt: string;
    media_type: string | null;
  }> = [];
  for (const [cid, all] of Object.entries(byCompetitor)) {
    if (all.length === 0) continue;
    const scores = all.map((p) => p.score).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)] ?? 0;
    if (median <= 0) continue;
    for (const { score, row } of all) {
      const posted = row.posted_at ?? "";
      if (!posted || posted < since7) continue;
      if (score < median * BREAKOUT_MULTIPLIER) continue;
      breakouts.push({
        competitor_id: cid,
        post_id: row.post_id,
        posted_at: posted,
        score: Math.round(score),
        multiplier: Math.round((score / median) * 10) / 10,
        text_excerpt: (row.text ?? "").slice(0, 240),
        media_type: row.media_type,
      });
      competitorIds.add(cid);
    }
  }
  breakouts.sort((a, b) => b.score - a.score);
  const topBreakouts = breakouts.slice(0, 3);

  // 3. Top 3 hook patterns ranked by avg_score.
  const { data: hooks } = await client
    .from("hook_patterns")
    .select("template, sample_count, avg_score")
    .eq("account_id", account.id)
    .order("avg_score", { ascending: false })
    .limit(3);

  // Resolve competitor names.
  const compIdsArr = [...competitorIds];
  let competitorNames: Record<string, string> = {};
  if (compIdsArr.length > 0) {
    const { data: comps } = await client
      .from("competitors")
      .select("id, identifier, display_name")
      .in("id", compIdsArr);
    for (const c of comps ?? []) {
      competitorNames[c.id as string] = (c.display_name as string) || (c.identifier as string);
    }
  }

  return {
    account: {
      id: account.id,
      name: account.name,
      brand_color: account.brand_color,
      logo_url: account.logo_url,
    },
    week_start: isoWeekStart(new Date()),
    changes: (changes ?? []).map((c) => ({
      competitor: competitorNames[c.competitor_id as string] ?? "Unknown",
      kind: c.kind as string,
      before: c.before_value as string | null,
      after: c.after_value as string | null,
      detected_at: c.detected_at as string,
    })),
    breakouts: topBreakouts.map((b) => ({
      ...b,
      competitor_name: competitorNames[b.competitor_id] ?? "Unknown",
    })),
    hook_recommendations: (hooks ?? []).map((h) => ({
      template: h.template as string,
      sample: h.sample_count as number,
      avg_score: Math.round(Number(h.avg_score)),
    })),
  };
}

export const weeklyClientReport = schedules.task({
  id: "weekly-client-report",
  cron: "0 9 * * 1",   // Monday 9am UTC
  maxDuration: 60 * 15,
  run: async (_payload, { ctx }) => {
    const client = supabase();
    const { data: accounts } = await client
      .from("accounts")
      .select("id, name, brand_color, logo_url")
      .is("archived_at", null);

    const week_start = isoWeekStart(new Date());
    const summary: Array<{ account: string; ok: boolean; share_token?: string; error?: string }> = [];

    for (const a of (accounts ?? []) as Account[]) {
      try {
        const payload = await buildReportPayload(client, a);
        const { data, error } = await client
          .from("client_reports")
          .upsert(
            { account_id: a.id, week_start, payload, generated_at: new Date().toISOString() },
            { onConflict: "account_id,week_start" },
          )
          .select("share_token")
          .single();
        if (error) throw new Error(error.message);
        summary.push({ account: a.name, ok: true, share_token: data.share_token as string });
      } catch (e) {
        summary.push({ account: a.name, ok: false, error: (e as Error).message });
      }
    }

    logger.info("weekly report run complete", { runId: ctx.run.id, summary });
    return { summary };
  },
});
