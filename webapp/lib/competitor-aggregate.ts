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
