"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AddCompetitorForm } from "./AddCompetitorForm";
import { CompetitorRow } from "./CompetitorRow";
import { CompareGrid } from "@/components/competitors/CompareGrid";

type CompetitorRowData = {
  id: string;
  profile_url: string;
  identifier: string;
  display_name: string | null;
  role: string;
  active: boolean;
  notes: string | null;
  added_at: string;
  last_analyzed_at: string | null;
  post_count: number;
  top_score: number;
  is_self?: boolean;
};

type SortKey = "creator" | "role" | "post_count" | "top_score" | "last_analyzed_at";
type SortDir = "asc" | "desc";

const ROLE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "direct", label: "Direct" },
  { value: "format_source", label: "Format" },
  { value: "topic_source", label: "Topic" },
];

function sortValue(c: CompetitorRowData, key: SortKey): string | number {
  switch (key) {
    case "creator":
      return (c.display_name || c.identifier).toLowerCase();
    case "role":
      return c.role;
    case "post_count":
      return c.post_count;
    case "top_score":
      return c.top_score;
    case "last_analyzed_at":
      return c.last_analyzed_at ? Date.parse(c.last_analyzed_at) : 0;
  }
}

export function CompetitorsView({
  competitors,
  loadError,
}: {
  competitors: CompetitorRowData[];
  loadError: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "compare" ? "compare" : "list";

  const [sortBy, setSortBy] = useState<SortKey>("top_score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      // Text sorts default A→Z; numeric/date sorts default high→low.
      setSortDir(key === "creator" || key === "role" ? "asc" : "desc");
    }
  }

  function setTab(next: string) {
    const sp = new URLSearchParams(params.toString());
    if (next === "list") {
      sp.delete("tab");
      sp.delete("ids");
    } else {
      sp.set("tab", "compare");
      // Default-all-selected on first switch — preserves bookmarkable subsets
      // when the user comes back via a saved URL.
      if (!sp.get("ids")) {
        sp.set("ids", competitors.filter((c) => c.active).map((c) => c.id).join(","));
      }
    }
    const qs = sp.toString();
    router.replace(qs ? `/competitors?${qs}` : "/competitors");
  }

  const activeCompetitors = competitors.filter((c) => c.active);
  const initialSelectedIds = (params.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const effectiveSelectedIds =
    initialSelectedIds.length > 0
      ? initialSelectedIds
      : activeCompetitors.map((c) => c.id);

  // Per-role counts for the filter pills.
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { all: competitors.length };
    for (const c of competitors) counts[c.role] = (counts[c.role] ?? 0) + 1;
    return counts;
  }, [competitors]);

  // Max top score across the whole set drives the relative score bars, so
  // bar widths stay stable regardless of the active filter.
  const maxTopScore = useMemo(
    () => competitors.reduce((m, c) => Math.max(m, c.top_score), 0),
    [competitors],
  );

  // Filter, then sort. The self row is pinned to the top as the baseline
  // regardless of sort, then everything else follows the chosen order.
  const visible = useMemo(() => {
    const filtered =
      roleFilter === "all"
        ? [...competitors]
        : competitors.filter((c) => c.role === roleFilter);
    filtered.sort((a, b) => {
      if (a.is_self && !b.is_self) return -1;
      if (b.is_self && !a.is_self) return 1;
      const av = sortValue(a, sortBy);
      const bv = sortValue(b, sortBy);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return filtered;
  }, [competitors, roleFilter, sortBy, sortDir]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList>
        <TabsTrigger value="list">List ({competitors.length})</TabsTrigger>
        <TabsTrigger value="compare">Compare</TabsTrigger>
      </TabsList>

      <TabsContent value="list" className="space-y-4">
        <AddCompetitorForm />

        {loadError ? (
          <p className="text-sm text-red-700">Failed to load: {loadError}</p>
        ) : competitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No competitors yet. Paste a LinkedIn profile URL above to start tracking.
          </p>
        ) : (
          <>
            {/* Role filter pills */}
            <div className="flex flex-wrap gap-1.5">
              {ROLE_FILTERS.map((f) => {
                const count = roleCounts[f.value] ?? 0;
                if (f.value !== "all" && count === 0) return null;
                const active = roleFilter === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setRoleFilter(f.value)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      active
                        ? "bg-lynx-charcoal text-white"
                        : "border border-border bg-background text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {f.label}
                    <span className={cn("ml-1.5", active ? "text-white/70" : "text-muted-foreground/60")}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <SortableHeader label="Creator" sortKey="creator" active={sortBy} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Role" sortKey="role" active={sortBy} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Posts" sortKey="post_count" active={sortBy} dir={sortDir} onSort={toggleSort} align="right" />
                    <SortableHeader label="Top score" sortKey="top_score" active={sortBy} dir={sortDir} onSort={toggleSort} />
                    <SortableHeader label="Last analyzed" sortKey="last_analyzed_at" active={sortBy} dir={sortDir} onSort={toggleSort} />
                    <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((c) => (
                    <CompetitorRow key={c.id} competitor={c} maxTopScore={maxTopScore} />
                  ))}
                </tbody>
              </table>
            </div>
            {visible.length === 0 ? (
              <p className="text-sm text-muted-foreground">No competitors in this role.</p>
            ) : null}
          </>
        )}
      </TabsContent>

      <TabsContent value="compare">
        {activeCompetitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active competitors yet. Add some in the List tab first.
          </p>
        ) : (
          <CompareGrid
            allCompetitors={activeCompetitors}
            initialSelectedIds={effectiveSelectedIds}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

function SortableHeader({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = active === sortKey;
  return (
    <th className={cn("py-2.5 px-3 font-semibold", align === "right" && "text-right")}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground",
          align === "right" && "flex-row-reverse",
          isActive ? "text-foreground" : "",
        )}
      >
        {label}
        {isActive ? (
          dir === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          )
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}
