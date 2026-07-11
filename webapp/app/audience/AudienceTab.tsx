"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

// Tab 1 — Audience. Shows demographic breakdowns of the current connections
// (and, when available, the follower snapshots discovered via the Voyager
// pass-through). Sub-tabs toggle the data source; the breakdowns re-fetch.

type Row = {
  id: string;
  provider_id: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  country: string | null;
  industry: string | null;
  current_company: string | null;
  current_role: string | null;
  profile_url: string | null;
};

type Breakdown = {
  total: number;
  by_country: Array<{ label: string; count: number }>;
  by_industry: Array<{ label: string; count: number }>;
  by_seniority: Array<{ label: string; key: string; count: number }>;
};

type Scan = {
  id: string;
  status: "running" | "completed" | "failed";
  total_walked: number | null;
  matches_upserted: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type SnapshotPoint = { captured_at: string; followers_count: number | null; connections_count: number | null };

type Source = "connections" | "followers";

export function AudienceTab() {
  const [source, setSource] = useState<Source>("connections");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [followerScan, setFollowerScan] = useState<Scan | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotPoint[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadRows = useCallback(async () => {
    setLoading(true);
    try {
      const path = source === "followers" ? "/api/audience/followers" : "/api/audience/connections";
      const q = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await fetch(`${path}${q}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "load failed");
      setRows(json.rows ?? []);
      setTotal(json.total ?? json.discovered ?? 0);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [source, search]);

  const loadBreakdown = useCallback(async () => {
    try {
      const res = await fetch(`/api/audience/breakdown?source=${source}`);
      const json = await res.json();
      if (res.ok) setBreakdown(json);
    } catch {
      // no-op
    }
  }, [source]);

  const loadScan = useCallback(async () => {
    try {
      const [c, f] = await Promise.all([
        fetch("/api/audience/scan").then((r) => r.json()),
        fetch("/api/audience/followers/scan").then((r) => r.json()),
      ]);
      setScan(c.scan ?? null);
      setFollowerScan(f.scan ?? null);
    } catch {
      // no-op
    }
  }, []);

  const loadSnapshots = useCallback(async () => {
    try {
      const res = await fetch("/api/audience/own-snapshots?days=90");
      const json = await res.json();
      if (res.ok) setSnapshots(json.series ?? []);
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => { void loadRows(); }, [loadRows]);
  useEffect(() => { void loadBreakdown(); }, [loadBreakdown]);
  useEffect(() => { void loadScan(); }, [loadScan]);
  useEffect(() => { void loadSnapshots(); }, [loadSnapshots]);

  useEffect(() => {
    const running = scan?.status === "running" || followerScan?.status === "running";
    if (!running) return;
    const id = setInterval(() => {
      void loadScan();
      void loadRows();
      void loadBreakdown();
    }, 5000);
    return () => clearInterval(id);
  }, [scan?.status, followerScan?.status, loadScan, loadRows, loadBreakdown]);

  const fireConnectionScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/audience/scan", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error);
      toast.success(`Scan started. Run: ${json.run_id}`);
      await loadScan();
    } catch (e) {
      toast.error(`Scan failed to start: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }, [loadScan]);

  const fireFollowerScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/audience/followers/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budget: 10 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error);
      toast.success(`Follower canary started. Budget: ${json.budget}`);
      await loadScan();
    } catch (e) {
      toast.error(`Follower scan failed to start: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }, [loadScan]);

  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
  const first = snapshots.length > 0 ? snapshots[0] : null;
  const delta =
    latest?.followers_count != null && first?.followers_count != null
      ? latest.followers_count - first.followers_count
      : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Connections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">{total.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">
              {scan?.status === "running"
                ? `Scanning ${scan.total_walked ?? 0}…`
                : scan?.finished_at
                ? `Last scan ${new Date(scan.finished_at).toLocaleString()}`
                : "No scans yet"}
            </div>
            <Button size="sm" onClick={fireConnectionScan} disabled={scanning || scan?.status === "running"}>
              {scan?.status === "running" ? "Scanning…" : "Rescan"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Followers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">
              {latest?.followers_count?.toLocaleString() ?? "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {followerScan?.status === "running"
                ? `Discovering ${followerScan.matches_upserted ?? 0}…`
                : followerScan?.finished_at
                ? `Discovered ${followerScan.matches_upserted ?? 0} profiles`
                : "No follower scans yet — Phase A canary is 10 profiles"}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={fireFollowerScan}
              disabled={scanning || followerScan?.status === "running"}
            >
              {followerScan?.status === "running" ? "Discovering…" : "Discover 10 (canary)"}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">90-day trend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-2xl font-bold">
              {delta != null ? (delta >= 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()) : "—"}
            </div>
            <div className="text-xs text-muted-foreground">
              {snapshots.length > 0
                ? `${snapshots.length} daily snapshots`
                : "Daily snapshots start tomorrow"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <BreakdownCard title="Top locations" rows={breakdown?.by_country ?? []} total={breakdown?.total ?? 0} />
        <BreakdownCard title="Top industries" rows={breakdown?.by_industry ?? []} total={breakdown?.total ?? 0} />
        <BreakdownCard title="Seniority mix" rows={breakdown?.by_seniority ?? []} total={breakdown?.total ?? 0} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {(["connections", "followers"] as Source[]).map((s) => (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`rounded border px-3 py-1 text-sm ${
                source === s ? "bg-foreground text-background" : "bg-background"
              }`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <Input
          placeholder="Search name / headline / company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm ml-2"
        />
        <div className="ml-auto text-xs text-muted-foreground">
          {loading ? "Loading…" : `${rows.length} shown`}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Name</th>
                  <th className="p-2">Headline</th>
                  <th className="p-2">Company</th>
                  <th className="p-2">Role</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Industry</th>
                  <th className="p-2 text-right">Profile</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-muted-foreground">
                      {source === "connections"
                        ? "No connections scanned yet. Hit Rescan on the Connections card above."
                        : "No followers discovered yet. Hit Discover 10 (canary) to start Phase A."}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b align-top">
                    <td className="p-2 font-medium">{r.full_name ?? "(no name)"}</td>
                    <td className="p-2 max-w-xs">
                      <div className="line-clamp-2">{r.headline ?? "-"}</div>
                    </td>
                    <td className="p-2">{r.current_company ?? "-"}</td>
                    <td className="p-2">{r.current_role ?? "-"}</td>
                    <td className="p-2">{r.location ?? "-"}</td>
                    <td className="p-2">{r.industry ?? "-"}</td>
                    <td className="p-2 text-right">
                      {r.profile_url && (
                        <a
                          href={r.profile_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border px-2 py-1 text-xs hover:bg-muted"
                        >
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
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
  total: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-2 text-muted-foreground">No data yet</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.label} className="border-t">
                <td className="px-3 py-2 truncate">{r.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground tabular-nums">
                  {total > 0 ? `${Math.round((r.count / total) * 100)}%` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
