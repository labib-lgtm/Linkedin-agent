"use client";

import { cadenceCells, type AggregatePost } from "@/lib/competitor-aggregate";

type Row = {
  id: string;
  display_name: string | null;
  identifier: string;
  is_self: boolean;
  recent_posts: AggregatePost[];
};

const DAYS = 28;

// Build the 28 dates that map to each cell, oldest → newest.
function dateAxis(days: number): Date[] {
  const out: Date[] = [];
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(todayUTC - i * 86_400_000));
  }
  return out;
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function fullDate(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

// 28-day cadence grid: one cell per day, intensity by post count. Replaces
// the day-of-week and hour-of-day bar charts — those compress time poorly
// (you can't tell consistency from a histogram). The cadence grid shows
// streaks, gaps, and bursts at a glance.
export function CadenceCalendar({ rows }: { rows: Row[] }) {
  const dates = dateAxis(DAYS);
  // Axis labels: every 7th cell — index 0, 7, 14, 21, plus "today" at 27.
  const tickIndexes = [0, 7, 14, 21, DAYS - 1];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">Posting cadence — last 28 days</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            One cell = one day. Darker = more posts. Hover a cell for the date.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>fewer</span>
          <span className="w-3 h-3 rounded-[2px] bg-muted" />
          <span className="w-3 h-3 rounded-[2px] bg-lime-200" />
          <span className="w-3 h-3 rounded-[2px] bg-lime-400" />
          <span className="w-3 h-3 rounded-[2px] bg-lime-600" />
          <span>more</span>
        </div>
      </div>

      {/* Date axis */}
      <div
        className="grid items-center gap-3 px-1.5 mb-1.5"
        style={{ gridTemplateColumns: "120px 1fr 60px" }}
      >
        <span />
        <div className="grid gap-[2px] relative" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
          {dates.map((d, i) => (
            <span
              key={i}
              className="text-[9px] uppercase tracking-wider text-muted-foreground/70 text-center font-medium"
              style={{ gridColumn: i + 1 }}
            >
              {tickIndexes.includes(i) ? (i === DAYS - 1 ? "today" : shortDate(d)) : ""}
            </span>
          ))}
        </div>
        <span />
      </div>

      <div className="space-y-1">
        {rows.map((r) => {
          const cells = cadenceCells(r.recent_posts, DAYS);
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
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
                {cells.map((count, i) => {
                  const isToday = i === DAYS - 1;
                  const isWeekBoundary = i > 0 && i % 7 === 0;
                  return (
                    <span
                      key={i}
                      className={`aspect-square rounded-[2px] ${cellClass(count)} ${
                        isToday ? "ring-1 ring-foreground/40 ring-offset-[1px] ring-offset-background" : ""
                      } ${isWeekBoundary ? "ml-[2px]" : ""}`}
                      title={`${fullDate(dates[i])} — ${count} post${count === 1 ? "" : "s"}`}
                    />
                  );
                })}
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
