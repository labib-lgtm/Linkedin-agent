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

// Same bucketing as cadenceCells, but keeps the posts so the popover
// can show what was actually posted that day.
function postsByCell(posts: AggregatePost[], days: number): AggregatePost[][] {
  const buckets: AggregatePost[][] = Array.from({ length: days }, () => []);
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const p of posts) {
    if (!p.posted_at) continue;
    const d = new Date(p.posted_at);
    if (Number.isNaN(d.getTime())) continue;
    const dUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const ago = Math.floor((todayUTC - dUTC) / 86_400_000);
    if (ago < 0 || ago >= days) continue;
    buckets[days - 1 - ago].push(p);
  }
  return buckets;
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
            One cell = one day. Darker = more posts. Hover a cell to see the posts.
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
        <div className="grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${DAYS}, 1fr)` }}>
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
          const buckets = postsByCell(r.recent_posts, DAYS);
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
                {cells.map((count, i) => (
                  <Cell
                    key={i}
                    date={dates[i]}
                    count={count}
                    posts={buckets[i]}
                    isToday={i === DAYS - 1}
                    isWeekBoundary={i > 0 && i % 7 === 0}
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

function Cell({
  date,
  count,
  posts,
  isToday,
  isWeekBoundary,
}: {
  date: Date;
  count: number;
  posts: AggregatePost[];
  isToday: boolean;
  isWeekBoundary: boolean;
}) {
  const sorted = [...posts].sort(
    (a, b) => Number(b.engagement_score ?? 0) - Number(a.engagement_score ?? 0),
  );
  const visible = sorted.slice(0, 3);
  const more = posts.length - visible.length;

  return (
    <div className={`relative group ${isWeekBoundary ? "ml-[2px]" : ""}`}>
      <div
        className={`aspect-square rounded-[2px] ${cellClass(count)} ${
          isToday ? "ring-1 ring-foreground/40 ring-offset-[1px] ring-offset-background" : ""
        } ${count > 0 ? "cursor-pointer hover:ring-1 hover:ring-foreground/60" : ""}`}
      />
      {/* Hover popover. Anchored above the cell, centered. */}
      <div
        className="hidden group-hover:block absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2
                   w-72 rounded-lg border border-border bg-foreground text-background shadow-xl
                   p-3 text-[11px] leading-snug pointer-events-none"
      >
        <div className="font-semibold mb-1.5 flex items-center justify-between gap-2">
          <span>{fullDate(date)}</span>
          <span className="text-background/70 text-[10px] uppercase tracking-wider">
            {posts.length} post{posts.length === 1 ? "" : "s"}
          </span>
        </div>
        {posts.length === 0 ? (
          <div className="text-background/60 italic">No posts that day.</div>
        ) : (
          <ul className="space-y-1.5">
            {visible.map((p) => {
              const score = Math.round(Number(p.engagement_score ?? 0));
              const txt = (p.text ?? "").replace(/\s+/g, " ").trim();
              const excerpt = txt.length > 110 ? `${txt.slice(0, 110)}…` : txt;
              const media = p.media_type && p.media_type !== "text" ? p.media_type : null;
              return (
                <li key={p.post_id} className="flex flex-col gap-0.5 pb-1.5 border-b border-background/15 last:border-0 last:pb-0">
                  <span className="text-background/90">&ldquo;{excerpt || "(no text)"}&rdquo;</span>
                  <span className="flex items-center gap-2 text-[10px] text-background/65">
                    <span className="font-mono">score {score}</span>
                    <span>·</span>
                    <span>
                      {(p.reactions ?? 0)} reactions · {(p.comments ?? 0)} comments · {(p.reposts ?? 0)} reposts
                    </span>
                    {media ? <span>· {media}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {more > 0 ? (
          <div className="mt-1.5 text-[10px] text-background/55 italic">
            + {more} more post{more === 1 ? "" : "s"} that day
          </div>
        ) : null}
        {/* Arrow pointer */}
        <div
          className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0
                     border-l-[6px] border-r-[6px] border-t-[6px]
                     border-l-transparent border-r-transparent border-t-foreground"
        />
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
