"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FORMAT_VALUES, PILLAR_VALUES } from "@/lib/constants";

export default function NewAnglePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [hookSeed, setHookSeed] = useState("");
  const [angleId, setAngleId] = useState("");
  const [weekAssigned, setWeekAssigned] = useState("");

  // Auto-suggest the next angle id (YYYY-WNN-AXX) for the current week. The
  // field stays editable — this is just a sensible default.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/angles/next-id")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        if (d.next_id) setAngleId((cur) => cur || d.next_id);
        if (d.week_assigned) setWeekAssigned((cur) => cur || d.week_assigned);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // "Draft this style" stashes the full breakout post in sessionStorage and
  // navigates here with ?seed=1. Pull it into the hook seed, then clear it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("seed")) return;
    const seed = sessionStorage.getItem("angle_seed");
    if (seed) {
      setHookSeed(seed);
      sessionStorage.removeItem("angle_seed");
    }
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const fd = new FormData(e.currentTarget);
    const payload = {
      angle_id: String(fd.get("angle_id") ?? "").trim(),
      pillar: (String(fd.get("pillar") ?? "") || null) as string | null,
      format: (String(fd.get("format") ?? "") || null) as string | null,
      hook_seed: String(fd.get("hook_seed") ?? "").trim() || null,
      cta_keyword: String(fd.get("cta_keyword") ?? "").trim().toUpperCase() || null,
      week_assigned: String(fd.get("week_assigned") ?? "").trim() || null,
      notes: String(fd.get("notes") ?? "").trim() || null,
      status: "Pending",
    };

    if (!payload.angle_id) {
      setError("angle_id is required (e.g. 2026-W19-A01)");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/angles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }

    router.push(`/angles/${payload.angle_id}`);
    router.refresh();
  }

  return (
    <div className="container-tight py-6 sm:py-8 max-w-2xl">
      <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight mb-6">
        New angle
      </h1>

      <Card>
        <CardHeader>
          <CardTitle>Idea seed</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="angle_id">Angle ID</Label>
              <Input
                id="angle_id"
                name="angle_id"
                placeholder="2026-W19-A01"
                value={angleId}
                onChange={(e) => setAngleId(e.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                Convention: <span className="font-mono">YYYY-WNN-AXX</span>
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pillar">Pillar</Label>
                <select
                  id="pillar"
                  name="pillar"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {PILLAR_VALUES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="format">Format</Label>
                <select
                  id="format"
                  name="format"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {FORMAT_VALUES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hook_seed">Hook seed</Label>
              <Textarea
                id="hook_seed"
                name="hook_seed"
                rows={hookSeed ? 8 : 3}
                value={hookSeed}
                onChange={(e) => setHookSeed(e.target.value)}
                placeholder="The 3-line operator's note..."
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cta_keyword">CTA keyword</Label>
                <Input
                  id="cta_keyword"
                  name="cta_keyword"
                  placeholder="KILL"
                  className="uppercase"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="week_assigned">Week assigned</Label>
                <Input
                  id="week_assigned"
                  name="week_assigned"
                  placeholder="2026-W19"
                  value={weekAssigned}
                  onChange={(e) => setWeekAssigned(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={3} />
            </div>

            {error ? (
              <p className="text-sm text-red-700">{error}</p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="submit" variant="accent" disabled={submitting}>
                {submitting ? "Creating..." : "Create angle"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
