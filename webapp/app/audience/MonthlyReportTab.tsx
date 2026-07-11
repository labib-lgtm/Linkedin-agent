"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Report = {
  month: string;
  audience: {
    followers_start: number | null;
    followers_end: number | null;
    connections_start: number | null;
    connections_end: number | null;
    current_connections: number;
  };
  requests: {
    total_sent: number;
    accepted: number;
    withdrawn: number;
    acceptance_rate: number;
  };
  prospects: {
    new_from_competitors: number;
  };
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyReportTab() {
  const [month, setMonth] = useState(currentMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/audience/report/${month}`);
      const json = await res.json();
      if (res.ok) setReport(json);
      else setReport(null);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="max-w-xs"
        />
        {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
      </div>

      {report && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-sm">Audience growth</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Stat label="Followers start" value={report.audience.followers_start} />
              <Stat label="Followers end" value={report.audience.followers_end} />
              <Stat
                label="Followers Δ"
                value={
                  report.audience.followers_end != null && report.audience.followers_start != null
                    ? report.audience.followers_end - report.audience.followers_start
                    : null
                }
              />
              <Stat label="Connections start" value={report.audience.connections_start} />
              <Stat label="Connections end" value={report.audience.connections_end} />
              <Stat label="Total connections now" value={report.audience.current_connections} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">Outbound requests</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <Stat label="Total sent" value={report.requests.total_sent} />
              <Stat label="Accepted" value={report.requests.accepted} />
              <Stat label="Withdrawn" value={report.requests.withdrawn} />
              <Stat label="Acceptance rate" value={`${Math.round(report.requests.acceptance_rate * 100)}%`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm">New prospects sourced</CardTitle></CardHeader>
            <CardContent>
              <Stat label="From competitor engagers" value={report.prospects.new_from_competitors} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string | null }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">
        {value == null ? "—" : typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}
