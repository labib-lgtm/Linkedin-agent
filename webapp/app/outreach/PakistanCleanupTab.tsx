"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Pakistan connection cleanup tab.
//
// Unipile does not expose a disconnect endpoint, so this tab is a
// discovery + audit tool: the scan task walks every LinkedIn connection,
// filters by location keywords, and lands matches in
// pakistan_cleanup_targets. The operator then clicks "Open profile" on
// each row (opens LinkedIn in a new tab, does the 3-click removal
// manually), and hits "Mark removed" to update the audit trail.
//
// Everything the operator does is reversible via "Undo" on removed rows.

type Target = {
  id: string;
  provider_id: string;
  public_identifier: string | null;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  matched_keyword: string | null;
  profile_url: string | null;
  status: "pending" | "removed" | "skipped";
  removed_at: string | null;
  scanned_at: string;
};

type Totals = { pending: number; removed: number; skipped: number };

type Scan = {
  id: string;
  run_id: string | null;
  status: "running" | "completed" | "failed";
  total_relations: number | null;
  profiles_fetched: number;
  matches_found: number;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type StatusTab = "pending" | "removed" | "skipped" | "all";

export function PakistanCleanupTab() {
  const [tab, setTab] = useState<StatusTab>("pending");
  const [targets, setTargets] = useState<Target[]>([]);
  const [totals, setTotals] = useState<Totals>({ pending: 0, removed: 0, skipped: 0 });
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/outreach/pakistan-cleanup/targets?status=${tab}&limit=1000`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "load failed");
      setTargets(json.targets ?? []);
      setTotals(json.totals ?? { pending: 0, removed: 0, skipped: 0 });
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [tab]);

  const loadScan = useCallback(async () => {
    try {
      const res = await fetch("/api/outreach/pakistan-cleanup/scan");
      const json = await res.json();
      if (!res.ok) return;
      setScan(json.scan ?? null);
    } catch {
      // no-op
    }
  }, []);

  useEffect(() => {
    void loadTargets();
  }, [loadTargets]);

  useEffect(() => {
    void loadScan();
  }, [loadScan]);

  // Poll scan status every 5s while a scan is running so the operator sees
  // matches_found tick up in real time.
  useEffect(() => {
    if (scan?.status !== "running") return;
    const id = setInterval(() => {
      void loadScan();
      void loadTargets();
    }, 5_000);
    return () => clearInterval(id);
  }, [scan?.status, loadScan, loadTargets]);

  const fireScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/outreach/pakistan-cleanup/scan", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error ?? "trigger failed");
      toast.success(`Scan started. Run: ${json.run_id}`);
      await loadScan();
    } catch (e) {
      toast.error(`Scan failed to start: ${(e as Error).message}`);
    } finally {
      setScanning(false);
    }
  }, [loadScan]);

  const mark = useCallback(
    async (id: string, status: "removed" | "skipped" | "pending") => {
      try {
        const res = await fetch("/api/outreach/pakistan-cleanup/mark", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "mark failed");
        // Optimistically remove the row from the current view if the status
        // changed off the current tab. Cheaper than a full reload.
        setTargets((prev) => prev.filter((t) => t.id !== id || tab === "all"));
        // But keep totals in sync — refetch just the head counts.
        void loadTargets();
      } catch (e) {
        toast.error(`Update failed: ${(e as Error).message}`);
      }
    },
    [tab, loadTargets],
  );

  const scanRunning = scan?.status === "running";
  const scanLabel = useMemo(() => {
    if (!scan) return "No scans yet.";
    if (scan.status === "running") {
      const total = scan.total_relations ?? 0;
      const fetched = scan.profiles_fetched ?? 0;
      const matched = scan.matches_found ?? 0;
      return `Scanning ${fetched} / ${total || "…"} profiles — ${matched} matched so far.`;
    }
    if (scan.status === "failed") {
      return `Last scan failed: ${scan.error ?? "unknown error"}`;
    }
    const finishedRelative = scan.finished_at
      ? new Date(scan.finished_at).toLocaleString()
      : "?";
    return `Last scan: ${finishedRelative} — ${scan.matches_found} matches out of ${scan.total_relations ?? 0} connections.`;
  }, [scan]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pakistan cleanup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Unipile does not expose a disconnect API, so this tab discovers Pakistan-located
            connections and lets you remove them via LinkedIn&apos;s own UI. Click a row&apos;s
            &quot;Open profile&quot; button, use LinkedIn&apos;s Remove connection option, then
            hit &quot;Mark removed&quot; here to log it.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">{scanLabel}</span>
            <Button size="sm" onClick={fireScan} disabled={scanning || scanRunning}>
              {scanRunning ? "Scan running…" : scanning ? "Starting…" : "Run scan"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 text-sm">
        {(["pending", "removed", "skipped", "all"] as StatusTab[]).map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`rounded border px-3 py-1 ${
              tab === s ? "bg-foreground text-background" : "bg-background"
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}{" "}
            {s !== "all" && (
              <span className="text-xs opacity-70">({totals[s]})</span>
            )}
          </button>
        ))}
        <div className="ml-auto text-xs text-muted-foreground">
          {loading ? "Loading…" : `${targets.length} shown`}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Name</th>
                  <th className="p-2">Headline</th>
                  <th className="p-2">Location</th>
                  <th className="p-2">Matched</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targets.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} className="p-4 text-center text-muted-foreground">
                      {tab === "pending"
                        ? "No pending Pakistan-located connections. Run a scan to look for more."
                        : `No ${tab} rows.`}
                    </td>
                  </tr>
                )}
                {targets.map((t) => (
                  <tr key={t.id} className="border-b align-top">
                    <td className="p-2">
                      <div className="font-medium">{t.full_name ?? "(no name)"}</div>
                      {t.public_identifier && (
                        <div className="text-xs text-muted-foreground">
                          {t.public_identifier}
                        </div>
                      )}
                    </td>
                    <td className="p-2 max-w-xs">
                      <div className="line-clamp-2">{t.headline ?? "-"}</div>
                    </td>
                    <td className="p-2">{t.location ?? "-"}</td>
                    <td className="p-2 text-xs">{t.matched_keyword ?? "-"}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        {t.profile_url && (
                          <a
                            href={t.profile_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded border px-2 py-1 text-xs hover:bg-muted"
                          >
                            Open profile
                          </a>
                        )}
                        {t.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => mark(t.id, "removed")}
                            >
                              Mark removed
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => mark(t.id, "skipped")}
                            >
                              Skip
                            </Button>
                          </>
                        )}
                        {t.status !== "pending" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => mark(t.id, "pending")}
                          >
                            Undo
                          </Button>
                        )}
                      </div>
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
