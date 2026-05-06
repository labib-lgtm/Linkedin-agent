"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
};

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

  return (
    <Tabs value={tab} onValueChange={setTab} className="w-full">
      <TabsList>
        <TabsTrigger value="list">List ({competitors.length})</TabsTrigger>
        <TabsTrigger value="compare">Compare</TabsTrigger>
      </TabsList>

      <TabsContent value="list" className="space-y-6">
        <AddCompetitorForm />

        {loadError ? (
          <p className="text-sm text-red-700">Failed to load: {loadError}</p>
        ) : competitors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No competitors yet. Paste a LinkedIn profile URL above to start tracking.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-background">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-3 px-3 font-semibold">Creator</th>
                  <th className="py-3 px-3 font-semibold">Role</th>
                  <th className="py-3 px-3 font-semibold">Posts</th>
                  <th className="py-3 px-3 font-semibold">Top score</th>
                  <th className="py-3 px-3 font-semibold">Last analyzed</th>
                  <th className="py-3 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => (
                  <CompetitorRow key={c.id} competitor={c} />
                ))}
              </tbody>
            </table>
          </div>
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
