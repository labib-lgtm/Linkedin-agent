"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Competitor = {
  id: string;
  name: string;
  identifier: string;
  followers_count: number | null;
  connections_count: number | null;
  delta_30d: number | null;
  last_snapshot_at: string | null;
  engagers_this_month: number;
};

type Engager = {
  id: string;
  provider_id: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  industry: string | null;
  current_company: string | null;
  current_role: string | null;
  profile_url: string | null;
  signal_type: "comment" | "reaction" | "both";
  matched_segment_ids: string[];
  first_seen_at: string;
  last_seen_at: string;
};

export function CompetitorsTab() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [engagers, setEngagers] = useState<Engager[]>([]);
  const [mining, setMining] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/audience/competitors");
    const json = await res.json();
    if (res.ok) {
      setCompetitors(json.competitors ?? []);
      if (!selectedId && json.competitors?.[0]) setSelectedId(json.competitors[0].id);
    }
  }, [selectedId]);

  const loadEngagers = useCallback(async () => {
    if (!selectedId) { setEngagers([]); return; }
    const res = await fetch(`/api/audience/competitors/${selectedId}/engagers`);
    const json = await res.json();
    if (res.ok) setEngagers(json.engagers ?? []);
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadEngagers(); }, [loadEngagers]);

  const mine = useCallback(async () => {
    setMining(true);
    try {
      const res = await fetch("/api/audience/competitors/mine-engagers", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error);
      toast.success("Mining started (may take ~10 min)");
    } catch (e) {
      toast.error(`Mining failed: ${(e as Error).message}`);
    } finally {
      setMining(false);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Reuses your existing tracked competitors (manage in the /competitors page). Follower time
          series and engager mining feed prospect suggestions in Targeting.
        </div>
        <Button size="sm" variant="outline" onClick={mine} disabled={mining}>
          {mining ? "Mining…" : "Mine engagers now"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Name</th>
                  <th className="p-2 text-right">Followers</th>
                  <th className="p-2 text-right">30d Δ</th>
                  <th className="p-2 text-right">Engagers this month</th>
                  <th className="p-2">Last snapshot</th>
                </tr>
              </thead>
              <tbody>
                {competitors.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground">
                      No competitors tracked. Add some at /competitors.
                    </td>
                  </tr>
                )}
                {competitors.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`cursor-pointer border-b ${selectedId === c.id ? "bg-muted" : ""}`}
                  >
                    <td className="p-2 font-medium">{c.name}</td>
                    <td className="p-2 text-right tabular-nums">{c.followers_count?.toLocaleString() ?? "-"}</td>
                    <td className="p-2 text-right tabular-nums">
                      {c.delta_30d != null ? (c.delta_30d >= 0 ? `+${c.delta_30d}` : c.delta_30d) : "-"}
                    </td>
                    <td className="p-2 text-right tabular-nums">{c.engagers_this_month.toLocaleString()}</td>
                    <td className="p-2 text-xs">
                      {c.last_snapshot_at ? new Date(c.last_snapshot_at).toLocaleDateString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selectedId && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Engagers ({engagers.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">Name</th>
                    <th className="p-2">Headline</th>
                    <th className="p-2">Company</th>
                    <th className="p-2">Location</th>
                    <th className="p-2">Signal</th>
                    <th className="p-2">Segments</th>
                    <th className="p-2 text-right">Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {engagers.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-muted-foreground">
                        No engagers yet. Click Mine engagers to run the discovery.
                      </td>
                    </tr>
                  )}
                  {engagers.map((e) => (
                    <tr key={e.id} className="border-b align-top">
                      <td className="p-2 font-medium">{e.full_name ?? "(no name)"}</td>
                      <td className="p-2 max-w-xs">
                        <div className="line-clamp-2 text-xs">{e.headline ?? "-"}</div>
                      </td>
                      <td className="p-2">{e.current_company ?? "-"}</td>
                      <td className="p-2">{e.location ?? "-"}</td>
                      <td className="p-2 text-xs">{e.signal_type}</td>
                      <td className="p-2 text-xs">{e.matched_segment_ids.length > 0 ? `${e.matched_segment_ids.length} match` : "-"}</td>
                      <td className="p-2 text-right">
                        {e.profile_url && (
                          <a href={e.profile_url} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs hover:bg-muted">
                            Open
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
