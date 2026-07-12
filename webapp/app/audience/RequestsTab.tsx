"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Invitation = {
  id: string;
  provider_id: string;
  full_name: string | null;
  headline: string | null;
  note: string | null;
  status: "sent" | "pending" | "accepted" | "withdrawn" | "expired";
  sent_at: string;
  accepted_at: string | null;
  withdrawn_at: string | null;
  withdraw_reason: string | null;
  segment_id: string | null;
  // PostgREST embeds a single-row FK as either the object or an array
  // depending on how the FK relationship is declared; handle both.
  segment: { name: string } | { name: string }[] | null;
};

function segmentName(inv: Invitation): string {
  if (!inv.segment_id) return "Amazon seller";
  const s = inv.segment;
  if (!s) return "Segment";
  if (Array.isArray(s)) return s[0]?.name ?? "Segment";
  return s.name ?? "Segment";
}

type Rollup = {
  total_sent: number;
  accepted: number;
  withdrawn: number;
  acceptance_rate: number;
  avg_time_to_accept_hours: number | null;
};

type StatusFilter = "all" | "sent" | "pending" | "accepted" | "withdrawn" | "expired";

export function RequestsTab() {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audience/requests?status=${status}&limit=1000`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setRows(json.rows ?? []);
      setRollup(json.rollup ?? null);
      setTotals(json.totals ?? {});
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/audience/requests/refresh", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error);
      toast.success("Refresh started");
      setTimeout(() => void load(), 3000);
    } catch (e) {
      toast.error(`Refresh failed: ${(e as Error).message}`);
    }
  }, [load]);

  const withdraw = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/audience/requests/${id}/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message ?? json.error);
        toast.success("Withdrawn");
        void load();
      } catch (e) {
        toast.error(`Withdraw failed: ${(e as Error).message}`);
      }
    },
    [load],
  );

  const staleCount = useMemo(() => {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    return rows.filter(
      (r) => (r.status === "pending" || r.status === "sent") && new Date(r.sent_at).getTime() < cutoff,
    ).length;
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard title="Sent this month" value={rollup?.total_sent ?? 0} />
        <StatCard
          title="Accepted"
          value={rollup?.accepted ?? 0}
          hint={rollup ? `${Math.round(rollup.acceptance_rate * 100)}% acceptance` : ""}
        />
        <StatCard
          title="Avg time to accept"
          value={rollup?.avg_time_to_accept_hours != null ? `${Math.round(rollup.avg_time_to_accept_hours)}h` : "—"}
        />
        <StatCard
          title="Withdrawn this month"
          value={rollup?.withdrawn ?? 0}
          hint={staleCount > 0 ? `${staleCount} stale (>14d), highlighted below` : ""}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(["all", "sent", "pending", "accepted", "withdrawn", "expired"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded border px-3 py-1 ${status === s ? "bg-foreground text-background" : "bg-background"}`}
          >
            {s[0].toUpperCase() + s.slice(1)}
            {s !== "all" && <span className="ml-1 text-xs opacity-70">({totals[s] ?? 0})</span>}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh}>Refresh status</Button>
          <div className="text-xs text-muted-foreground">{loading ? "Loading…" : `${rows.length} shown`}</div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="p-2">Name</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">Note</th>
                  <th className="p-2">Sent</th>
                  <th className="p-2">Age</th>
                  <th className="p-2">Status</th>
                  <th className="p-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-muted-foreground">
                      No invitations. Once you send some via the Targeting tab they show up here.
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const ageDays = Math.floor((Date.now() - new Date(r.sent_at).getTime()) / 86_400_000);
                  const isStale =
                    (r.status === "pending" || r.status === "sent") && ageDays >= 14;
                  return (
                    <tr key={r.id} className={`border-b align-top ${isStale ? "bg-yellow-50 dark:bg-yellow-950/30" : ""}`}>
                      <td className="p-2 font-medium">{r.full_name ?? "(no name)"}</td>
                      <td className="p-2 text-xs">{segmentName(r)}</td>
                      <td className="p-2 max-w-xs">
                        <div className="line-clamp-2 text-xs text-muted-foreground">{r.note ?? "-"}</div>
                      </td>
                      <td className="p-2 whitespace-nowrap text-xs">
                        {new Date(r.sent_at).toLocaleDateString()}
                      </td>
                      <td className="p-2 text-xs">
                        {ageDays}d {isStale && <span title="Withdraw before LinkedIn spam-flags you"> ⚠</span>}
                      </td>
                      <td className="p-2">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="p-2 text-right">
                        {(r.status === "sent" || r.status === "pending" || r.status === "expired") && (
                          <Button size="sm" variant="outline" onClick={() => withdraw(r.id)}>
                            Withdraw
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, hint }: { title: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: Invitation["status"] }) {
  const colors = {
    sent: "bg-blue-100 text-blue-900",
    pending: "bg-blue-100 text-blue-900",
    accepted: "bg-green-100 text-green-900",
    withdrawn: "bg-gray-100 text-gray-700",
    expired: "bg-yellow-100 text-yellow-900",
  };
  return <span className={`rounded px-2 py-0.5 text-xs ${colors[status]}`}>{status}</span>;
}
