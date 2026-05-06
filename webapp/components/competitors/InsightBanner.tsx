"use client";

import { useMemo } from "react";
import {
  topHookByPrefix,
  closestAnalog,
  type AggregatePost,
} from "@/lib/competitor-aggregate";

type Row = {
  id: string;
  display_name: string | null;
  identifier: string;
  is_self: boolean;
  recent_posts: AggregatePost[];
  avg_engagement_score: number;
};

// Three single-sentence insights at the top of Compare. Phase 1 templated
// (driven by SQL/JS only). Phase 4 will replace card #1 with real LLM hook
// extraction. Phase 3 will replace card #2 with profile change events.
export function InsightBanner({ rows }: { rows: Row[] }) {
  const data = useMemo(() => {
    const all = rows.flatMap((r) => r.recent_posts);
    const top = topHookByPrefix(all, 1);
    const self = rows.find((r) => r.is_self);
    const others = rows.filter((r) => !r.is_self);
    const analog = self
      ? closestAnalog(
          { id: self.id, posts: self.recent_posts },
          others.map((o) => ({
            id: o.id,
            name: o.display_name || o.identifier,
            posts: o.recent_posts,
          })),
        )
      : null;
    // Median post score across the peer set, for the "top hook is X× median"
    // framing on card #1.
    const scores = all
      .map((p) => Number(p.engagement_score ?? 0) || 0)
      .filter((s) => s > 0)
      .sort((a, b) => a - b);
    const median = scores.length === 0 ? 0 : scores[Math.floor(scores.length / 2)];
    return { top: top[0] ?? null, analog, median, totalPosts: all.length };
  }, [rows]);

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
      <Card tone="win" label="What's winning">
        {data.top && data.median > 0 ? (
          <>
            <strong>&ldquo;{titleCase(data.top.prefix).slice(0, 60)}&hellip;&rdquo;</strong> hooks
            averaged{" "}
            <strong>{Math.round(data.top.avg_score).toLocaleString()}</strong> engagement —{" "}
            <strong>
              {data.median > 0 ? `${(data.top.avg_score / data.median).toFixed(1)}×` : "—"}
            </strong>{" "}
            the median post (n={data.top.sample}).
          </>
        ) : (
          <span className="text-muted-foreground">
            Still learning. Need more posts in the peer set before patterns surface.
          </span>
        )}
      </Card>

      <Card tone="warn" label="Positioning shifts (last 30d)">
        <span className="text-muted-foreground">
          Daily profile snapshots ship in Phase 3. Tagline + cover change detection lights up here
          once the worker runs.
        </span>
      </Card>

      <Card tone="info" label="Closest analog to you">
        {data.analog ? (
          <>
            <strong>{data.analog.name}</strong> — same posting volume + format mix as you, but{" "}
            <strong>
              {data.analog.selfAvgScore > 0
                ? `${(data.analog.theirAvgScore / data.analog.selfAvgScore).toFixed(1)}×`
                : "—"}
            </strong>{" "}
            your avg engagement. Best account to study this week.
          </>
        ) : (
          <span className="text-muted-foreground">
            Mark a competitor as <strong>Self</strong> in /competitors to compute analogs.
          </span>
        )}
      </Card>
    </div>
  );
}

function Card({
  tone,
  label,
  children,
}: {
  tone: "win" | "warn" | "info";
  label: string;
  children: React.ReactNode;
}) {
  const accent =
    tone === "win"
      ? "border-l-emerald-500"
      : tone === "warn"
        ? "border-l-amber-500"
        : "border-l-foreground";
  return (
    <div className={`rounded-xl border border-border bg-card p-4 border-l-[3px] ${accent}`}>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">
        {label}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
