"use client";

import { useState } from "react";
import { CompareModal, type SnapshotRow } from "./CompareModal";
import { colorFor } from "@/lib/competitor-aggregate";

type ChangeEvent = { competitor_id: string; detected_at: string; kind: string };

export type ProfileRow = {
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

// Prefer the Storage thumbnail (stable), then the original LinkedIn CDN URL.
function bestCoverUrl(snap: SnapshotRow | null): string | null {
  if (!snap) return null;
  return publicCoverUrl(snap.cover_thumb_path) ?? snap.cover_url ?? null;
}

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function changeAge(events: ChangeEvent[], kind: string): { label: string; recent: boolean } {
  const evt = events.find((e) => e.kind === kind);
  if (!evt) return { label: "60d+", recent: false };
  const d = daysAgo(evt.detected_at);
  if (d <= 0) return { label: "today", recent: true };
  if (d <= 7) return { label: `${d}d ago`, recent: true };
  return { label: `${d}d`, recent: false };
}

// Phase 3 snapshot strip — six cards (one per competitor in the active
// peer set). Cover thumbnail, headline, "Tagline Xd ago" + "Cover Xd ago"
// timestamps, recent-change orange dot. Click expand button → side-by-side
// modal.
export function ProfileSnapshotStrip({ rows }: { rows: ProfileRow[] }) {
  const [modalOpen, setModalOpen] = useState(false);

  const haveData = rows.some((r) => r.latest_snapshot);

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold">Profile snapshot</h2>
          <p className="text-[11px] text-muted-foreground">
            Tagline + cover + audience metrics. Daily worker captures changes.
            <span className="ml-1 text-amber-700">●</span> = changed in last 7d.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="px-3 py-1.5 rounded-md border border-border bg-background hover:bg-muted text-sm font-medium"
          disabled={!haveData}
          title={haveData ? "Compare side-by-side" : "Snapshots haven't run yet"}
        >
          ⤢ Expand · compare side-by-side
        </button>
      </div>

      {!haveData ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
          No snapshots yet. Trigger.dev daily-profile-snapshot task hasn&apos;t run for these
          competitors. The first run usually happens at 5am UTC.
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {rows.slice(0, 6).map((r, i) => {
            const snap = r.latest_snapshot;
            const tagline = changeAge(r.recent_events, "headline");
            const cover = changeAge(r.recent_events, "cover");
            const coverUrl = bestCoverUrl(snap);
            const pictureUrl = snap?.picture_url ?? null;
            const initials = (r.display_name || r.identifier).slice(0, 2).toUpperCase();
            const tint = r.is_self ? "#0e0e0e" : colorFor(i);
            return (
              <div
                key={r.id}
                className="rounded-xl border border-border bg-card overflow-hidden flex flex-col hover:border-foreground/30 transition-colors"
              >
                <div
                  className="h-[60px] flex items-center justify-center text-[9px] uppercase tracking-widest text-white/60 relative overflow-hidden"
                  style={
                    coverUrl
                      ? { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                      : { background: `linear-gradient(135deg, ${tint}88, ${tint})` }
                  }
                >
                  {!coverUrl ? r.identifier : null}
                  {cover.recent ? (
                    <span className="absolute top-1.5 right-1.5 bg-white/95 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded">
                      {cover.label}
                    </span>
                  ) : null}
                </div>
                <div className="p-3 flex-1 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={pictureUrl}
                        alt={r.display_name || r.identifier}
                        className="w-5 h-5 rounded-full object-cover shrink-0 border border-border"
                      />
                    ) : (
                      <span
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[9px] font-semibold text-white shrink-0"
                        style={{ background: tint }}
                      >
                        {initials}
                      </span>
                    )}
                    <span className="text-xs font-semibold truncate">
                      {r.display_name || r.identifier}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug min-h-[42px]">
                    {snap?.headline || "—"}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-2 border-t border-border">
                    <span className={tagline.recent ? "text-amber-700 font-semibold" : ""}>
                      Tagline {tagline.label} {tagline.recent ? "●" : ""}
                    </span>
                    <span className={cover.recent ? "text-amber-700 font-semibold" : ""}>
                      Cover {cover.label} {cover.recent ? "●" : ""}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CompareModal open={modalOpen} onClose={() => setModalOpen(false)} rows={rows} />
    </section>
  );
}
