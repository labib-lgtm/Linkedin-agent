"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { colorFor } from "@/lib/competitor-aggregate";

export type SnapshotRow = {
  competitor_id?: string;
  captured_at: string;
  headline: string | null;
  cover_url: string | null;
  cover_thumb_path: string | null;
  picture_url: string | null;
  followers_count: number | null;
  connections_count: number | null;
};

type ChangeEvent = {
  competitor_id: string;
  detected_at: string;
  kind: string;
  diff_score?: number | null;
};

type Row = {
  id: string;
  display_name: string | null;
  identifier: string;
  role: string;
  is_self: boolean;
  latest_snapshot: SnapshotRow | null;
  snapshot_history: SnapshotRow[];
  recent_events: ChangeEvent[];
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "competitor-covers";

function publicCoverUrl(thumbPath: string | null): string | null {
  if (!thumbPath || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${thumbPath}`;
}

// Pick the best available cover image URL — prefer the Storage thumbnail
// (stable, our origin), then fall back to LinkedIn's CDN URL on the snapshot
// (rotates eventually but renders today). Returns null if neither is set.
function bestCoverUrl(snap: SnapshotRow | null): string | null {
  if (!snap) return null;
  return publicCoverUrl(snap.cover_thumb_path) ?? snap.cover_url ?? null;
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function fmtFollowers(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}

type Filter = "all" | "recent" | "direct" | "format";

// Side-by-side compare modal. Each competitor renders as a full-width row:
//   cover · identity stats · tagline (with previous if changed) · 3-event history
// Self row is anchored at the bottom for visual reference.
export function CompareModal({
  open,
  onClose,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  rows: Row[];
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const self = rows.find((r) => r.is_self);
  const others = rows.filter((r) => !r.is_self);

  const filtered = others.filter((r) => {
    if (filter === "recent") return r.recent_events.length > 0;
    if (filter === "direct") return r.role === "direct";
    if (filter === "format") return r.role === "format_source";
    return true;
  });

  const recentChangeCount = others.filter((r) => r.recent_events.length > 0).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-5 pb-3 border-b border-border">
          <DialogTitle className="text-lg font-semibold">
            Profile compare — last 30 days
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Headlines, cover changes, audience metrics, and recent events. Self anchored at bottom.
          </p>
        </DialogHeader>

        <div className="px-6 py-3 border-b border-border bg-muted/20 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Filter:</span>
          {(["all", "recent", "direct", "format"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md border ${
                filter === f
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {f === "all"
                ? "All"
                : f === "recent"
                  ? `Recently changed (${recentChangeCount})`
                  : f === "direct"
                    ? "Direct"
                    : "Format"}
            </button>
          ))}
        </div>

        {recentChangeCount >= 2 ? (
          <div className="mx-6 mt-4 px-4 py-3 rounded-lg bg-foreground text-background flex items-start gap-3 text-sm">
            <span className="bg-lynx-green text-lynx-charcoal w-7 h-7 rounded-md flex items-center justify-center font-bold shrink-0">
              !
            </span>
            <span>
              <strong className="text-lynx-green">{recentChangeCount}</strong> competitors changed
              their profile in the last 30 days. Worth studying what they shifted toward.
            </span>
          </div>
        ) : null}

        <div className="p-6 space-y-3">
          {filtered.map((r, i) => (
            <CompareRow key={r.id} row={r} colorIndex={i} anchored={false} />
          ))}
          {self ? <CompareRow row={self} colorIndex={-1} anchored /> : null}
          {filtered.length === 0 && !self ? (
            <p className="text-sm text-muted-foreground text-center py-6">
              No competitors match this filter.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CompareRow({
  row,
  colorIndex,
  anchored,
}: {
  row: Row;
  colorIndex: number;
  anchored: boolean;
}) {
  const snap = row.latest_snapshot;
  const prior = row.snapshot_history[1] ?? null; // second-most-recent
  const tint = anchored ? "#0e0e0e" : colorFor(colorIndex);
  const coverUrl = bestCoverUrl(snap);
  const pictureUrl = snap?.picture_url ?? null;
  const initials = (row.display_name || row.identifier).slice(0, 2).toUpperCase();

  // Detect a recent headline change; show prior headline strikethrough.
  const headlineEvent = row.recent_events.find((e) => e.kind === "headline");
  const showPrior = headlineEvent && prior?.headline && prior.headline !== snap?.headline;

  return (
    <div
      className={`grid gap-5 p-4 rounded-xl border ${
        anchored
          ? "border-l-[3px] border-l-foreground bg-lynx-green/5"
          : row.recent_events.length > 0
            ? "border-l-[3px] border-l-amber-500 border-border bg-card"
            : "border-border bg-card"
      }`}
      style={{ gridTemplateColumns: "200px 240px 1fr 200px" }}
    >
      {/* Cover */}
      <div
        className="rounded-lg min-h-[130px] relative overflow-hidden flex items-center justify-center text-white/50 text-[10px] uppercase tracking-widest"
        style={
          coverUrl
            ? { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
            : { background: `linear-gradient(135deg, ${tint}88, ${tint})` }
        }
      >
        {!coverUrl ? row.identifier : null}
        {row.recent_events.find((e) => e.kind === "cover") ? (
          <span className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
            new cover
          </span>
        ) : null}
      </div>

      {/* Identity + audience + activity */}
      <div className="flex flex-col justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            {pictureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pictureUrl}
                alt={row.display_name || row.identifier}
                className="w-7 h-7 rounded-full object-cover border border-border"
              />
            ) : (
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-semibold text-white"
                style={{ background: tint }}
              >
                {initials}
              </span>
            )}
            <span className="font-semibold">{row.display_name || row.identifier}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-border">
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
              Audience
            </div>
            <div className="font-mono text-sm font-semibold">{fmtFollowers(snap?.followers_count)}</div>
            <div className="text-[10px] text-muted-foreground">followers</div>
          </div>
          <div>
            <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
              Network
            </div>
            <div className="font-mono text-sm font-semibold">
              {fmtFollowers(snap?.connections_count)}
            </div>
            <div className="text-[10px] text-muted-foreground">connections</div>
          </div>
        </div>
      </div>

      {/* Tagline */}
      <div className="flex flex-col gap-2">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Headline
        </div>
        <div className="text-sm leading-relaxed">{snap?.headline || "—"}</div>
        {showPrior ? (
          <div className="pt-2 border-t border-dashed border-border">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Was
            </div>
            <div className="text-xs italic text-muted-foreground line-through">
              {prior?.headline}
            </div>
          </div>
        ) : null}
      </div>

      {/* Recent events */}
      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Recent activity
        </div>
        {row.recent_events.length === 0 ? (
          <div className="text-[11px] text-muted-foreground italic">No changes detected.</div>
        ) : (
          row.recent_events.slice(0, 3).map((e) => (
            <div
              key={`${e.kind}-${e.detected_at}`}
              className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-[11px]"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
              <span className="text-amber-800 capitalize">
                {e.kind === "followers_milestone"
                  ? `Hit ${Number(e.diff_score ?? "")} followers`
                  : `${e.kind} changed`}
              </span>
              <span className="text-[10px] text-amber-700 ml-auto shrink-0">
                {daysAgo(e.detected_at)}d
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
