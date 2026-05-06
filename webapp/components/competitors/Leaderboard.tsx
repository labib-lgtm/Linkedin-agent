"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { AggregatePost, CompetitorAggregate } from "@/lib/competitor-aggregate";
import { weeklySparkline, colorFor } from "@/lib/competitor-aggregate";

type Row = CompetitorAggregate & {
  is_self: boolean;
  recent_posts: AggregatePost[];
};

type SortKey = "posts_per_week" | "avg_score" | "top_score" | "reactions" | "comments" | "default";

const ROLE_TONE: Record<string, string> = {
  direct: "bg-blue-100 text-blue-800",
  format_source: "bg-violet-100 text-violet-800",
  topic_source: "bg-amber-100 text-amber-800",
};

const ROLE_LABEL: Record<string, string> = {
  direct: "Direct",
  format_source: "Format",
  topic_source: "Topic",
};

// Phase 1 leaderboard: sortable table with the self row pinned at top, every
// other row showing %-deltas vs self, and inline-SVG sparklines for the WoW
// trend column. No charts, no LLMs — pure aggregation on the data already
// fetched by the compare API.
export function Leaderboard({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "default",
    dir: "desc",
  });

  const self = rows.find((r) => r.is_self);
  const others = rows.filter((r) => !r.is_self);

  // Per-row computed columns so sorting + delta calc share a single pass.
  type Computed = {
    row: Row;
    posts_per_week: number;
    avg_score: number;
    top_score: number;
    reactions: number;
    comments: number;
    sparkline: number[];
  };
  const computed: Computed[] = useMemo(
    () =>
      rows.map((r) => ({
        row: r,
        // 28d window from the API, divided by 4 = posts/week.
        posts_per_week: Math.round((r.recent_posts.length / 4) * 10) / 10,
        avg_score: r.avg_engagement_score,
        top_score: r.top_post?.score ?? 0,
        reactions: r.total_reactions,
        comments: r.total_comments,
        sparkline: weeklySparkline(r.recent_posts, 8),
      })),
    [rows],
  );

  // Per-column #1 leader for the badge. Self is excluded from leader picks.
  const leader = useMemo(() => {
    const pick = (key: keyof Computed): string | null => {
      let best: Computed | null = null;
      for (const c of computed) {
        if (c.row.is_self) continue;
        if (!best || (c[key] as number) > (best[key] as number)) best = c;
      }
      return best ? best.row.id : null;
    };
    return {
      posts_per_week: pick("posts_per_week"),
      avg_score: pick("avg_score"),
      top_score: pick("top_score"),
      reactions: pick("reactions"),
      comments: pick("comments"),
    };
  }, [computed]);

  function sortedComputed(): Computed[] {
    if (sort.key === "default") return computed;
    const key = sort.key;
    const sorted = [...computed].sort((a, b) => {
      // Always pin self first regardless of sort.
      if (a.row.is_self) return -1;
      if (b.row.is_self) return 1;
      const av = (a as unknown as Record<string, number>)[key] ?? 0;
      const bv = (b as unknown as Record<string, number>)[key] ?? 0;
      return sort.dir === "asc" ? av - bv : bv - av;
    });
    return sorted;
  }

  function clickSort(key: SortKey) {
    setSort((cur) => {
      if (cur.key !== key) return { key, dir: "desc" };
      if (cur.dir === "desc") return { key, dir: "asc" };
      return { key: "default", dir: "desc" };
    });
  }

  function arrow(key: SortKey) {
    if (sort.key !== key) return <span className="ml-1 text-[10px] text-muted-foreground">⇅</span>;
    return (
      <span className="ml-1 text-[10px] text-lynx-charcoal">{sort.dir === "asc" ? "↑" : "↓"}</span>
    );
  }

  // Cell with value + delta vs self. Self row shows "baseline" instead.
  function cell(value: number, key: keyof Computed, c: Computed, isLeader: boolean) {
    if (c.row.is_self) {
      return (
        <td className="py-3 px-3 text-right tabular-nums text-sm">
          {fmtNum(value)}
          <span className="block mt-0.5 text-[10px] text-muted-foreground">baseline</span>
        </td>
      );
    }
    const selfValue = self ? Number(self[key as keyof typeof self] ?? 0) : 0;
    const delta = computeDelta(value, selfValue);
    return (
      <td
        className={`py-3 px-3 text-right tabular-nums text-sm ${isLeader ? "font-semibold" : ""}`}
      >
        <span className="inline-flex items-center gap-2">
          {fmtNum(value)}
          {isLeader ? (
            <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
              #1
            </span>
          ) : null}
        </span>
        <span
          className={`block mt-0.5 text-[10px] tabular-nums ${
            delta.tone === "up"
              ? "text-emerald-700"
              : delta.tone === "down"
                ? "text-rose-700"
                : "text-muted-foreground"
          }`}
        >
          {delta.label}
        </span>
      </td>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40">
          <tr className="text-left">
            <th className="py-3 px-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              Competitor
            </th>
            <th
              className="py-3 px-3 text-right text-[11px] uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground"
              onClick={() => clickSort("posts_per_week")}
            >
              Posts / wk{arrow("posts_per_week")}
            </th>
            <th
              className="py-3 px-3 text-right text-[11px] uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground"
              onClick={() => clickSort("avg_score")}
            >
              Avg score{arrow("avg_score")}
            </th>
            <th
              className="py-3 px-3 text-right text-[11px] uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground"
              onClick={() => clickSort("top_score")}
            >
              Top score{arrow("top_score")}
            </th>
            <th
              className="py-3 px-3 text-right text-[11px] uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground"
              onClick={() => clickSort("reactions")}
            >
              Reactions{arrow("reactions")}
            </th>
            <th
              className="py-3 px-3 text-right text-[11px] uppercase tracking-wide text-muted-foreground cursor-pointer select-none hover:text-foreground"
              onClick={() => clickSort("comments")}
            >
              Comments{arrow("comments")}
            </th>
            <th className="py-3 px-3 text-right text-[11px] uppercase tracking-wide text-muted-foreground">
              WoW trend
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedComputed().map((c, idx) => {
            const r = c.row;
            const initials = (r.display_name || r.identifier).slice(0, 2).toUpperCase();
            const color = colorFor(idx);
            return (
              <tr
                key={r.id}
                className={`border-t border-border ${
                  r.is_self ? "bg-lynx-green/5" : "hover:bg-muted/20"
                }`}
              >
                <td className="py-3 px-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold text-white"
                      style={{ background: r.is_self ? "#0e0e0e" : color }}
                    >
                      {initials}
                    </span>
                    <div className="min-w-0">
                      <Link
                        href={`/competitors/${r.id}`}
                        className={`font-medium hover:underline ${r.is_self ? "" : ""}`}
                      >
                        {r.display_name || r.identifier}
                      </Link>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {r.is_self ? (
                          <span className="text-[10px] font-semibold bg-lynx-green text-lynx-charcoal px-2 py-0.5 rounded">
                            Self
                          </span>
                        ) : (
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              ROLE_TONE[r.role] ?? "bg-gray-100 text-gray-700"
                            }`}
                          >
                            {ROLE_LABEL[r.role] ?? r.role}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                {cell(c.posts_per_week, "posts_per_week", c, leader.posts_per_week === r.id)}
                {cell(Math.round(c.avg_score), "avg_score", c, leader.avg_score === r.id)}
                {cell(c.top_score, "top_score", c, leader.top_score === r.id)}
                {cell(c.reactions, "reactions", c, leader.reactions === r.id)}
                {cell(c.comments, "comments", c, leader.comments === r.id)}
                <td className="py-3 px-3 text-right">
                  <Sparkline values={c.sparkline} color={r.is_self ? "#0e0e0e" : color} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const W = 64;
  const H = 18;
  if (values.length === 0 || values.every((v) => v === 0)) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const max = Math.max(...values, 1);
  const stepX = W / Math.max(values.length - 1, 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = H - 2 - (v / max) * (H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={W} height={H} className="inline-block align-middle">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function fmtNum(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString("en-US");
}

function computeDelta(value: number, baseline: number): { label: string; tone: "up" | "down" | "flat" } {
  if (baseline <= 0) {
    if (value === 0) return { label: "—", tone: "flat" };
    return { label: "—", tone: "flat" };
  }
  const diff = value - baseline;
  if (diff === 0) return { label: "flat vs you", tone: "flat" };
  const pct = (diff / baseline) * 100;
  const sign = pct > 0 ? "+" : "";
  const label = `${sign}${Math.round(pct)}% vs you`;
  return { label, tone: pct >= 0 ? "up" : "down" };
}
