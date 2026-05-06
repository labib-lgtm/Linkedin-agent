"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  type AggregatePost,
  type CompetitorAggregate,
} from "@/lib/competitor-aggregate";
import { shortDate } from "@/lib/utils";
import { InsightBanner } from "./InsightBanner";
import { Leaderboard } from "./Leaderboard";
import { CadenceCalendar } from "./CadenceCalendar";
import { FormatMix } from "./FormatMix";
import { Breakouts } from "./Breakouts";
import { ProfileSnapshotStrip } from "./ProfileSnapshotStrip";
import type { SnapshotRow } from "./CompareModal";

const STALE_MS = 6 * 60 * 60 * 1000;

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

type CompetitorMeta = {
  id: string;
  identifier: string;
  display_name: string | null;
  role: string;
  last_analyzed_at: string | null;
  is_self?: boolean;
};

type ChangeEvent = {
  competitor_id: string;
  detected_at: string;
  kind: string;
  diff_score?: number | null;
};

type CompareCompetitor = CompetitorAggregate & {
  is_self: boolean;
  recent_posts: AggregatePost[];
  latest_snapshot: SnapshotRow | null;
  snapshot_history: SnapshotRow[];
  recent_events: ChangeEvent[];
};

type CompareResponse = {
  competitors?: CompareCompetitor[];
  self_id?: string | null;
  error?: string;
};

// Phase 1 Compare v2 layout:
//   1. Competitor selector (kept; checkbox cards)
//   2. InsightBanner (3 templated cards)
//   3. Leaderboard (sortable, deltas vs Self, sparklines, #1 badges)
//   4. Profile snapshot strip placeholder (Phase 3)
//   5. CadenceCalendar (28-day grid)
//   6. FormatMix (stacked bars)
//   7. Breakouts (3x author median)
//
// The compare API always pins the is_self competitor into the response, so
// there's nothing to do here to "include self" — it's just there.
export function CompareGrid({
  allCompetitors,
  initialSelectedIds,
}: {
  allCompetitors: CompetitorMeta[];
  initialSelectedIds: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [aggregates, setAggregates] = useState<CompareCompetitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, startReanalyze] = useTransition();

  // Hide self from the selector (auto-included server-side); keep it in the
  // ordering of all rows for sparklines + leaderboard.
  const selectableCompetitors = useMemo(
    () => allCompetitors.filter((c) => !c.is_self),
    [allCompetitors],
  );

  const selectedIds = useMemo(() => {
    const fromUrl = (params.get("ids") ?? "").split(",").filter(Boolean);
    return fromUrl.length > 0 ? fromUrl : initialSelectedIds;
  }, [params, initialSelectedIds]);

  useEffect(() => {
    const ids = selectedIds.join(",");
    setLoading(true);
    fetch(`/api/competitors/compare?ids=${ids}`)
      .then((r) => r.json())
      .then((d: CompareResponse) => {
        if (d.error) throw new Error(d.error);
        setAggregates(d.competitors ?? []);
      })
      .catch((e: Error) => toast.error(`Compare load failed: ${e.message}`))
      .finally(() => setLoading(false));
  }, [selectedIds]);

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    const qs = next.join(",");
    router.replace(qs ? `/competitors?tab=compare&ids=${qs}` : "/competitors?tab=compare");
  }

  const staleSelected = aggregates.filter((a) => {
    if (a.is_self) return false;
    if (!a.last_analyzed_at) return true;
    return Date.now() - new Date(a.last_analyzed_at).getTime() > STALE_MS;
  });

  async function reanalyzeFirstStale() {
    const next = staleSelected[0];
    if (!next) {
      toast.info("All selected competitors analyzed in the last 6h");
      return;
    }
    startReanalyze(async () => {
      try {
        const res = await fetch(`/api/competitors/${next.id}/analyze`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          const detail = [data?.error, data?.message, data?.body].filter(Boolean).join(" — ");
          throw new Error(detail || `HTTP ${res.status}`);
        }
        toast.success(`Re-analyzed ${next.display_name || next.identifier} — ${data.fetched} posts`);
        const refresh = await fetch(`/api/competitors/compare?ids=${selectedIds.join(",")}`);
        const refreshed = (await refresh.json()) as CompareResponse;
        if (refreshed.competitors) setAggregates(refreshed.competitors);
      } catch (e) {
        toast.error(`Re-analyze failed: ${(e as Error).message}`);
      }
    });
  }

  const selfRow = aggregates.find((a) => a.is_self);
  const hasAggregates = aggregates.length > 0;

  return (
    <div className="space-y-6">
      {/* Selector */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {selectableCompetitors.map((c) => {
          const checked = selectedIds.includes(c.id);
          return (
            <label
              key={c.id}
              className={`flex items-start gap-2 rounded-md border p-3 cursor-pointer transition-colors ${
                checked
                  ? "border-lynx-green bg-lynx-green/5"
                  : "border-border bg-background hover:bg-muted/30"
              }`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggle(c.id)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {c.display_name || c.identifier}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0 text-[10px] font-semibold ${
                      ROLE_TONE[c.role] ?? "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {ROLE_LABEL[c.role] ?? c.role}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {c.last_analyzed_at
                    ? `analyzed ${shortDate(c.last_analyzed_at)}`
                    : "never analyzed"}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          {selfRow ? (
            <>
              <strong className="text-foreground">{selfRow.display_name || selfRow.identifier}</strong> is your
              Self baseline.{" "}
            </>
          ) : (
            <span className="text-amber-700">
              No Self competitor marked — leaderboard deltas will be flat. Mark one in the List tab.
            </span>
          )}{" "}
          {aggregates.length} competitors loaded · 28-day window
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={reanalyzeFirstStale}
          disabled={reanalyzing || aggregates.length === 0}
        >
          {reanalyzing
            ? "Re-analyzing..."
            : staleSelected.length === 0
              ? "All fresh"
              : `Re-analyze ${staleSelected.length} stale (1 per click)`}
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading aggregates...</p>
      ) : !hasAggregates ? (
        <p className="text-sm text-muted-foreground">
          No competitors selected. Tick at least one above.
        </p>
      ) : (
        <>
          {/* 1. Insight banner */}
          <InsightBanner rows={aggregates} />

          {/* 2. Leaderboard */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Leaderboard</h2>
              <span className="text-[11px] text-muted-foreground">
                Sortable · #1 highlighted per metric · all deltas vs Self
              </span>
            </div>
            <Leaderboard rows={aggregates} />
          </section>

          {/* 3. Profile snapshot strip + side-by-side modal */}
          <ProfileSnapshotStrip
            rows={aggregates.map((a) => ({
              id: a.id,
              display_name: a.display_name,
              identifier: a.identifier,
              role: a.role,
              is_self: a.is_self,
              latest_snapshot: a.latest_snapshot,
              snapshot_history: a.snapshot_history,
              recent_events: a.recent_events,
            }))}
          />

          {/* 4. Cadence calendar */}
          <CadenceCalendar rows={aggregates} />

          {/* 5. Format mix */}
          <FormatMix rows={aggregates} />

          {/* 6. Breakouts */}
          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">Breakout posts to study</h2>
              <span className="text-[11px] text-muted-foreground">
                ≥ 3× the author&apos;s own 90-day median ·{" "}
                <a className="underline hover:text-foreground" href="/methodology#breakouts">
                  methodology
                </a>
              </span>
            </div>
            <Breakouts rows={aggregates} />
          </section>
        </>
      )}
    </div>
  );
}
