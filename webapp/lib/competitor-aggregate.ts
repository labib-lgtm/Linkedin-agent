// Pure aggregation helpers for the compare view. All bucketing is done
// in JS after a single Supabase fetch — keeps the round-trip count low
// and the function fits Hobby's 10s ceiling at typical sizes (~150 rows).

import { isoWeekStart, weekKeyFromStart } from "./week";

export type AggregatePost = {
  competitor_id: string;
  post_id: string;
  posted_at: string | null;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  engagement_score: number | string | null;
  text: string | null;
  media_type: string | null;
  media_urls: unknown;
};

export type CompetitorAggregate = {
  id: string;
  identifier: string;
  display_name: string | null;
  role: string;
  last_analyzed_at: string | null;
  post_count: number;
  total_reactions: number;
  total_comments: number;
  total_reposts: number;
  avg_engagement_score: number;
  recent_7d_count: number;
  top_post: TopPost | null;
  posts_by_dow: Record<number, number>; // 0..6 (Sun=0)
  posts_by_hour: Record<number, number>; // 0..23 UTC
  posts_by_week: Record<string, number>; // 'YYYY-Www'
  engagement_trend: Array<{ week_start: string; week_key: string; avg_score: number; count: number }>;
  top5: TopPost[];
};

export type TopPost = {
  post_id: string;
  posted_at: string | null;
  score: number;
  excerpt: string;
  media_type: string | null;
  media_urls: unknown;
};

export type BreakoutPost = TopPost & {
  competitor_id: string;
  competitor_name: string;
  multiplier: number;            // score / author 90d median
  word_count: number;
  full_text: string;             // untruncated post body (for "Draft this style")
};

// Format types we render. 'none' = text-only post.
export type MediaType = "text" | "carousel" | "image" | "video" | "poll" | "document" | "article" | "gif" | "none";

export type LeaderboardRow = {
  id: string;
  identifier: string;
  display_name: string | null;
  role: string;
  is_self: boolean;
  posts_per_week: number;        // last 28 days / 4
  avg_score: number;
  top_score: number;
  total_reactions: number;
  total_comments: number;
  sparkline: number[];           // weekly avg score, last N weeks
};

function emptyDow(): Record<number, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
}

function emptyHour(): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < 24; i++) out[i] = 0;
  return out;
}

function toTopPost(p: AggregatePost): TopPost {
  return {
    post_id: p.post_id,
    posted_at: p.posted_at,
    score: Math.round(Number(p.engagement_score ?? 0)),
    excerpt: (p.text ?? "").slice(0, 140),
    media_type: p.media_type,
    media_urls: p.media_urls,
  };
}

export function aggregateCompetitor(
  meta: {
    id: string;
    identifier: string;
    display_name: string | null;
    role: string;
    last_analyzed_at: string | null;
  },
  posts: AggregatePost[],
): CompetitorAggregate {
  const post_count = posts.length;
  let total_reactions = 0;
  let total_comments = 0;
  let total_reposts = 0;
  let scoreSum = 0;
  let recent_7d_count = 0;
  const dow = emptyDow();
  const hour = emptyHour();
  const byWeek: Record<string, number> = {};
  const trendBuckets: Record<string, { sum: number; count: number; week_start: string }> = {};

  const sevenDaysAgo = Date.now() - 7 * 86_400_000;

  for (const p of posts) {
    total_reactions += Number(p.reactions ?? 0) || 0;
    total_comments += Number(p.comments ?? 0) || 0;
    total_reposts += Number(p.reposts ?? 0) || 0;
    const score = Number(p.engagement_score ?? 0) || 0;
    scoreSum += score;

    if (p.posted_at) {
      const d = new Date(p.posted_at);
      if (!Number.isNaN(d.getTime())) {
        if (d.getTime() >= sevenDaysAgo) recent_7d_count += 1;
        dow[d.getUTCDay()] += 1;
        hour[d.getUTCHours()] += 1;

        const week_start = isoWeekStart(d);
        const week_key = weekKeyFromStart(week_start);
        byWeek[week_key] = (byWeek[week_key] ?? 0) + 1;
        const bucket = trendBuckets[week_key] ?? { sum: 0, count: 0, week_start };
        bucket.sum += score;
        bucket.count += 1;
        trendBuckets[week_key] = bucket;
      }
    }
  }

  // Sort posts by score desc for top picks. Posts arrive sorted from the
  // route already, but be defensive in case a caller hands us raw rows.
  const sorted = [...posts].sort(
    (a, b) => (Number(b.engagement_score ?? 0) || 0) - (Number(a.engagement_score ?? 0) || 0),
  );

  const engagement_trend = Object.entries(trendBuckets)
    .map(([week_key, b]) => ({
      week_start: b.week_start,
      week_key,
      avg_score: b.count === 0 ? 0 : b.sum / b.count,
      count: b.count,
    }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));

  return {
    ...meta,
    post_count,
    total_reactions,
    total_comments,
    total_reposts,
    avg_engagement_score: post_count === 0 ? 0 : scoreSum / post_count,
    recent_7d_count,
    top_post: sorted[0] ? toTopPost(sorted[0]) : null,
    posts_by_dow: dow,
    posts_by_hour: hour,
    posts_by_week: byWeek,
    engagement_trend,
    top5: sorted.slice(0, 5).map(toTopPost),
  };
}

// Build the unified shape recharts wants: an array of points keyed on the
// X axis, with one numeric series per competitor.
export function dowChartData(
  aggregates: CompetitorAggregate[],
): Array<Record<string, string | number>> {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return labels.map((day, i) => {
    const point: Record<string, string | number> = { day };
    for (const a of aggregates) point[a.id] = a.posts_by_dow[i] ?? 0;
    return point;
  });
}

export function hourChartData(
  aggregates: CompetitorAggregate[],
): Array<Record<string, string | number>> {
  const out: Array<Record<string, string | number>> = [];
  for (let h = 0; h < 24; h++) {
    const point: Record<string, string | number> = { hour: `${h}` };
    for (const a of aggregates) point[a.id] = a.posts_by_hour[h] ?? 0;
    out.push(point);
  }
  return out;
}

export function trendChartData(
  aggregates: CompetitorAggregate[],
): Array<Record<string, string | number | null>> {
  const weekSet = new Set<string>();
  for (const a of aggregates) {
    for (const t of a.engagement_trend) weekSet.add(t.week_key);
  }
  const weeks = [...weekSet].sort();
  return weeks.map((week_key) => {
    const point: Record<string, string | number | null> = { week: week_key };
    for (const a of aggregates) {
      const t = a.engagement_trend.find((x) => x.week_key === week_key);
      point[a.id] = t ? Math.round(t.avg_score) : null;
    }
    return point;
  });
}

// Deterministic palette so each competitor keeps the same color across
// chart sections regardless of selection order. Hex values match Tailwind
// utility classes so the rest of the UI can reference them consistently.
export const SERIES_COLORS = [
  "#bef264", // lynx green
  "#1f2937", // charcoal
  "#f59e0b", // amber
  "#7c3aed", // violet
  "#0ea5e9", // sky
  "#ef4444", // red
  "#10b981", // emerald
  "#ec4899", // pink
] as const;

export function colorFor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

// =============================================================================
// Phase 1 helpers — leaderboard / breakouts / cadence / format mix / insights
// =============================================================================

// 90-day rolling median engagement score. Used as the baseline for breakout
// detection (a post >= 3x its author's own median is a breakout). Median is
// more robust to a single mega-post than mean; sample sizes are small enough
// that we sort each call (~30 posts max).
export function authorMedian(posts: AggregatePost[], windowDays = 90): number {
  const cutoff = Date.now() - windowDays * 86_400_000;
  const scores: number[] = [];
  for (const p of posts) {
    if (!p.posted_at) continue;
    const t = new Date(p.posted_at).getTime();
    if (Number.isNaN(t) || t < cutoff) continue;
    scores.push(Number(p.engagement_score ?? 0) || 0);
  }
  if (scores.length === 0) return 0;
  scores.sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  return scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
}

// Posts where engagement_score >= threshold * authorMedian. Returns enriched
// rows so the UI doesn't need to re-correlate against competitor metadata.
export function breakoutPosts(
  byCompetitor: Array<{
    id: string;
    name: string;
    posts: AggregatePost[];
  }>,
  threshold = 3,
): BreakoutPost[] {
  const out: BreakoutPost[] = [];
  for (const c of byCompetitor) {
    const median = authorMedian(c.posts);
    if (median <= 0) continue;
    for (const p of c.posts) {
      const score = Number(p.engagement_score ?? 0) || 0;
      if (score < median * threshold) continue;
      out.push({
        post_id: p.post_id,
        posted_at: p.posted_at,
        score: Math.round(score),
        excerpt: (p.text ?? "").slice(0, 220),
        full_text: p.text ?? "",
        media_type: p.media_type,
        media_urls: p.media_urls,
        competitor_id: c.id,
        competitor_name: c.name,
        multiplier: Math.round((score / median) * 10) / 10,
        word_count: (p.text ?? "").trim().split(/\s+/).filter(Boolean).length,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

// 28-cell array of post counts per day, ordered chronologically (oldest first).
// Cell index 0 = 27 days ago, index 27 = today (UTC).
export function cadenceCells(posts: AggregatePost[], days = 28): number[] {
  const cells = new Array<number>(days).fill(0);
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const p of posts) {
    if (!p.posted_at) continue;
    const d = new Date(p.posted_at);
    if (Number.isNaN(d.getTime())) continue;
    const dUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const daysAgo = Math.floor((todayUTC - dUTC) / 86_400_000);
    if (daysAgo < 0 || daysAgo >= days) continue;
    cells[days - 1 - daysAgo] += 1;
  }
  return cells;
}

// % share by media_type, normalized so values sum to 100. Null media_type
// folds into "text" (the default for text-only posts pre-migration 003).
export function formatMixPct(posts: AggregatePost[]): Record<MediaType, number> {
  const counts: Record<string, number> = {};
  let total = 0;
  for (const p of posts) {
    const mt = (p.media_type ?? "none") as string;
    const key = mt === "none" ? "text" : mt;
    counts[key] = (counts[key] ?? 0) + 1;
    total += 1;
  }
  const out: Record<MediaType, number> = {
    text: 0, carousel: 0, image: 0, video: 0, poll: 0,
    document: 0, article: 0, gif: 0, none: 0,
  };
  if (total === 0) return out;
  for (const k of Object.keys(counts)) {
    if (k in out) (out as Record<string, number>)[k] = Math.round((counts[k] / total) * 1000) / 10;
  }
  return out;
}

// Last N ISO weeks of avg engagement score per competitor. Used by the
// leaderboard sparkline column. Pads with zeros for weeks with no posts.
export function weeklySparkline(posts: AggregatePost[], weeks = 8): number[] {
  const buckets: Record<string, { sum: number; count: number; week_start: string }> = {};
  for (const p of posts) {
    if (!p.posted_at) continue;
    const d = new Date(p.posted_at);
    if (Number.isNaN(d.getTime())) continue;
    const week_start = isoWeekStart(d);
    const week_key = weekKeyFromStart(week_start);
    const score = Number(p.engagement_score ?? 0) || 0;
    const b = buckets[week_key] ?? { sum: 0, count: 0, week_start };
    b.sum += score;
    b.count += 1;
    buckets[week_key] = b;
  }
  // Build the last `weeks` weeks ending today, even if some had no posts.
  const today = new Date();
  const out: number[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const target = new Date(today);
    target.setUTCDate(target.getUTCDate() - i * 7);
    const ws = isoWeekStart(target);
    const wk = weekKeyFromStart(ws);
    const b = buckets[wk];
    out.push(b ? b.sum / b.count : 0);
  }
  return out;
}

// "Closest analog" — the competitor most similar to `self` by aggregate
// behavior. Vector: [posts_per_week, avg_score (z-scored), format mix shares].
// Returns the competitor id + cosine similarity. Powers the third insight card.
export function closestAnalog(
  self: { id: string; posts: AggregatePost[] },
  others: Array<{ id: string; name: string; posts: AggregatePost[] }>,
): { id: string; name: string; similarity: number; theirAvgScore: number; selfAvgScore: number } | null {
  function vector(posts: AggregatePost[]): number[] {
    const fmix = formatMixPct(posts);
    const total = posts.length;
    const scoreSum = posts.reduce((s, p) => s + (Number(p.engagement_score ?? 0) || 0), 0);
    const avg = total > 0 ? scoreSum / total : 0;
    return [
      total / 4,                 // posts per week (assuming 28d window)
      Math.log1p(avg) / 5,       // log-scaled avg score so 100 vs 5000 don't dominate
      fmix.text / 100, fmix.carousel / 100, fmix.video / 100, fmix.image / 100, fmix.poll / 100,
    ];
  }
  function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }
  const sv = vector(self.posts);
  const selfAvg = self.posts.length === 0
    ? 0
    : self.posts.reduce((s, p) => s + (Number(p.engagement_score ?? 0) || 0), 0) / self.posts.length;
  let best: { id: string; name: string; similarity: number; theirAvgScore: number } | null = null;
  for (const o of others) {
    if (o.id === self.id) continue;
    const sim = cosine(sv, vector(o.posts));
    const oavg = o.posts.length === 0
      ? 0
      : o.posts.reduce((s, p) => s + (Number(p.engagement_score ?? 0) || 0), 0) / o.posts.length;
    if (!best || sim > best.similarity) {
      best = { id: o.id, name: o.name, similarity: sim, theirAvgScore: oavg };
    }
  }
  if (!best) return null;
  return { ...best, selfAvgScore: selfAvg };
}

// Group posts by simple first-line prefix (60 chars, lowercased, punctuation
// stripped). Returns top hooks ranked by avg engagement_score, with sample
// counts. Used by InsightBanner card #1 until Phase 4 ships real LLM hook
// extraction.
export function topHookByPrefix(
  posts: AggregatePost[],
  topK = 5,
  minSample = 2,
): Array<{ prefix: string; sample: number; avg_score: number }> {
  const groups: Record<string, { sum: number; count: number }> = {};
  for (const p of posts) {
    const text = (p.text ?? "").trim();
    if (!text) continue;
    const firstLine = text.split(/\n/, 1)[0];
    const key = firstLine
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .slice(0, 60)
      .trim();
    if (!key) continue;
    const score = Number(p.engagement_score ?? 0) || 0;
    const g = groups[key] ?? { sum: 0, count: 0 };
    g.sum += score;
    g.count += 1;
    groups[key] = g;
  }
  return Object.entries(groups)
    .filter(([, g]) => g.count >= minSample)
    .map(([prefix, g]) => ({ prefix, sample: g.count, avg_score: g.sum / g.count }))
    .sort((a, b) => b.avg_score - a.avg_score)
    .slice(0, topK);
}
