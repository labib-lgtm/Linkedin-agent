"use client";

import { cadenceCells, type AggregatePost } from "@/lib/competitor-aggregate";

type Row = {
  id: string;
  display_name: string | null;
  identifier: string;
  is_self: boolean;
  recent_posts: AggregatePost[];
};

// 28-day cadence grid: one cell per day, intensity by post count. Replaces
// the day-of-week and hour-of-day bar charts — those compress time poorly
// (you can't tell consistency from a histogram). The cadence grid shows
// streaks, gaps, and bursts at a glance.
export function CadenceCalendar({ rows }: { rows: Row[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Posting cadence — last 28 days</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          One cell = one day. Darker = more posts that day.
        </p>
      </div>
      <div className="space-y-2">
        {rows.map((r) => {
          const cells = cadenceCells(r.recent_posts, 28);
          const totalPosts = cells.reduce((a, b) => a + b, 0);
          const perWeek = Math.round((totalPosts / 4) * 10) / 10;
          return (
            <div
              key={r.id}
              className={`grid items-center gap-3 px-1.5 py-1 rounded-md ${
                r.is_self ? "bg-lynx-green/5" : ""
              }`}
              style={{ gridTemplateColumns: "120px 1fr 60px" }}
            >
              <span
                className={`text-xs truncate ${r.is_self ? "font-semibold" : "text-muted-foreground"}`}
                title={r.display_name || r.identifier}
              >
                {r.display_name || r.identifier}
              </span>
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(28, 1fr)" }}>
                {cells.map((count, i) => (
                  <span
                    key={i}
                    className={`aspect-square rounded-[2px] ${cellClass(count)}`}
                    title={`${count} post${count === 1 ? "" : "s"}`}
                  />
                ))}
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground text-right font-medium">
                {perWeek}/wk
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function cellClass(count: number): string {
  if (count === 0) return "bg-muted";
  if (count === 1) return "bg-lime-200";
  if (count === 2) return "bg-lime-400";
  return "bg-lime-600";
}
