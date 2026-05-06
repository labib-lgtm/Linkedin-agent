"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { MediaTypeIcon } from "@/components/competitors/PostExpansion";
import {
  colorFor,
  dowChartData,
  hourChartData,
  trendChartData,
  type CompetitorAggregate,
} from "@/lib/competitor-aggregate";
import { shortDate } from "@/lib/utils";

// Dynamic-imported with ssr:false because recharts uses ResizeObserver
// which hydrates inconsistently in server components.
const PostsByDow = dynamic(() => import("@/components/charts/PostsByDow"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
const PostsByHour = dynamic(() => import("@/components/charts/PostsByHour"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});
const EngagementTrend = dynamic(() => import("@/components/charts/EngagementTrend"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

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
};

export function CompareGrid({
  allCompetitors,
  initialSelectedIds,
}: {
  allCompetitors: CompetitorMeta[];
  initialSelectedIds: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [aggregates, setAggregates] = useState<CompetitorAggregate[]>([]);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, startReanalyze] = useTransition();

  const selectedIds = useMemo(() => {
    const fromUrl = (params.get("ids") ?? "").split(",").filter(Boolean);
    return fromUrl.length > 0 ? fromUrl : initialSelectedIds;
  }, [params, initialSelectedIds]);

  // Refetch aggregates whenever selection changes.
  useEffect(() => {
    const ids = selectedIds.join(",");
    if (!ids) {
      setAggregates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/competitors/compare?ids=${ids}`)
      .then((r) => r.json())
      .then((d: { competitors?: CompetitorAggregate[]; error?: string }) => {
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
    router.replace(qs ? `/competitors/compare?ids=${qs}` : "/competitors/compare");
  }

  const series = aggregates.map((a, i) => ({
    id: a.id,
    name: a.display_name || a.identifier,
    color: colorFor(i),
  }));

  const staleSelected = aggregates.filter((a) => {
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
        // Refetch compare data so the page reflects the new posts.
        router.refresh();
        const refresh = await fetch(`/api/competitors/compare?ids=${selectedIds.join(",")}`);
        const refreshed = (await refresh.json()) as { competitors?: CompetitorAggregate[] };
        if (refreshed.competitors) setAggregates(refreshed.competitors);
      } catch (e) {
        toast.error(`Re-analyze failed: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Checkbox cards */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {allCompetitors.map((c) => {
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
          Showing {aggregates.length} of {allCompetitors.length} competitors
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
      ) : aggregates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No competitors selected. Tick at least one above.
        </p>
      ) : (
        <>
          <KpiTiles aggregates={aggregates} colors={series.map((s) => s.color)} />
          <ChartCard title="Posts by day of week (UTC)">
            <PostsByDow data={dowChartData(aggregates)} series={series} />
          </ChartCard>
          <ChartCard title="Posts by hour of day (UTC)">
            <PostsByHour data={hourChartData(aggregates)} series={series} />
          </ChartCard>
          <ChartCard title="Average engagement score by ISO week">
            <EngagementTrend data={trendChartData(aggregates)} series={series} />
          </ChartCard>
          <TopFiveGrid aggregates={aggregates} colors={series.map((s) => s.color)} />
        </>
      )}
    </div>
  );
}

function ChartSkeleton() {
  return <div className="h-60 rounded-md bg-muted/40 animate-pulse" />;
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function KpiTiles({
  aggregates,
  colors,
}: {
  aggregates: CompetitorAggregate[];
  colors: string[];
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${Math.min(aggregates.length, 4)}, minmax(0, 1fr))` }}
    >
      {aggregates.map((a, i) => (
        <Card key={a.id} className="overflow-hidden">
          <div className="h-1" style={{ backgroundColor: colors[i] }} />
          <CardContent className="p-4">
            <p className="font-medium text-sm truncate">{a.display_name || a.identifier}</p>
            <p className="text-[11px] text-muted-foreground mb-3">
              {a.post_count} posts · {a.recent_7d_count} in last 7d
            </p>
            <div className="grid grid-cols-2 gap-y-1 text-xs">
              <span className="text-muted-foreground">Avg score</span>
              <span className="text-right font-mono tabular-nums">
                {Math.round(a.avg_engagement_score)}
              </span>
              <span className="text-muted-foreground">Top score</span>
              <span className="text-right font-mono tabular-nums">{a.top_post?.score ?? 0}</span>
              <span className="text-muted-foreground">Reactions</span>
              <span className="text-right tabular-nums">{a.total_reactions}</span>
              <span className="text-muted-foreground">Comments</span>
              <span className="text-right tabular-nums">{a.total_comments}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function TopFiveGrid({
  aggregates,
  colors,
}: {
  aggregates: CompetitorAggregate[];
  colors: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 5 posts side by side</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <div
          className="grid gap-3 p-4 min-w-fit"
          style={{
            gridTemplateColumns: `repeat(${aggregates.length}, minmax(220px, 1fr))`,
          }}
        >
          {aggregates.map((a, i) => (
            <div key={a.id} className="space-y-2">
              <div className="flex items-center gap-2 pb-1 border-b border-border">
                <div className="h-2 w-2 rounded-full" style={{ backgroundColor: colors[i] }} />
                <p className="text-xs font-medium truncate">
                  {a.display_name || a.identifier}
                </p>
              </div>
              {a.top5.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">No posts.</p>
              ) : (
                a.top5.map((p) => (
                  <div
                    key={p.post_id}
                    className="rounded-md border border-border bg-background p-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <MediaTypeIcon mediaType={p.media_type} />
                        <span className="text-[10px]">
                          {p.posted_at ? shortDate(p.posted_at) : "—"}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums">{p.score}</span>
                    </div>
                    <p className="line-clamp-3 text-[11px] leading-snug">{p.excerpt || "—"}</p>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

