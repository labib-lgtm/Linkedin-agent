"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Segment = {
  id: string;
  name: string;
  industries: string[];
  role_keywords: string[];
  locations: string[];
  company_size_min: number | null;
  company_size_max: number | null;
  notes: string | null;
  weekly_quota: number;
};

type Gap = {
  total_audience: number;
  matching_audience: number;
  weekly_quota: number;
  sent_this_week: number;
};

export function TargetingTab() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const [creating, setCreating] = useState(false);

  const [draft, setDraft] = useState<{
    name: string;
    industries: string;
    role_keywords: string;
    locations: string;
    company_size_min: string;
    company_size_max: string;
    weekly_quota: string;
    notes: string;
  }>({
    name: "",
    industries: "",
    role_keywords: "",
    locations: "",
    company_size_min: "",
    company_size_max: "",
    weekly_quota: "20",
    notes: "",
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/audience/segments");
    const json = await res.json();
    if (res.ok) {
      setSegments(json.segments ?? []);
      if (!selectedId && json.segments?.[0]) setSelectedId(json.segments[0].id);
    }
  }, [selectedId]);

  const loadGap = useCallback(async () => {
    if (!selectedId) { setGap(null); return; }
    const res = await fetch(`/api/audience/segments/${selectedId}/gap`);
    const json = await res.json();
    if (res.ok) setGap(json);
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadGap(); }, [loadGap]);

  const save = useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error("Name required");
      return;
    }
    const arr = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
    const body = {
      name: draft.name,
      industries: arr(draft.industries),
      role_keywords: arr(draft.role_keywords),
      locations: arr(draft.locations),
      company_size_min: draft.company_size_min ? Number(draft.company_size_min) : null,
      company_size_max: draft.company_size_max ? Number(draft.company_size_max) : null,
      weekly_quota: Number(draft.weekly_quota) || 20,
      notes: draft.notes || null,
    };
    const res = await fetch("/api/audience/segments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Save failed");
      return;
    }
    toast.success(`Segment created`);
    setDraft({ name: "", industries: "", role_keywords: "", locations: "", company_size_min: "", company_size_max: "", weekly_quota: "20", notes: "" });
    setCreating(false);
    setSelectedId(json.id);
    void load();
  }, [draft, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Archive this segment?")) return;
    const res = await fetch(`/api/audience/segments/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Archived");
      if (selectedId === id) setSelectedId(null);
      void load();
    }
  }, [load, selectedId]);

  const selected = segments.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader className="pb-2 flex items-center justify-between">
          <CardTitle className="text-sm">Segments</CardTitle>
          <Button size="sm" onClick={() => setCreating((v) => !v)}>
            {creating ? "Close" : "+ New"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {creating && (
            <div className="space-y-2 rounded border p-3">
              <Input placeholder="Name (e.g. US Amazon founders 11-50)"
                value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input placeholder="Industries (comma-separated)"
                value={draft.industries} onChange={(e) => setDraft({ ...draft, industries: e.target.value })} />
              <Input placeholder="Role keywords (comma-separated: founder, ceo, owner...)"
                value={draft.role_keywords} onChange={(e) => setDraft({ ...draft, role_keywords: e.target.value })} />
              <Input placeholder="Locations (comma-separated: US, United States, ...)"
                value={draft.locations} onChange={(e) => setDraft({ ...draft, locations: e.target.value })} />
              <div className="flex gap-2">
                <Input type="number" placeholder="Size min"
                  value={draft.company_size_min} onChange={(e) => setDraft({ ...draft, company_size_min: e.target.value })} />
                <Input type="number" placeholder="Size max"
                  value={draft.company_size_max} onChange={(e) => setDraft({ ...draft, company_size_max: e.target.value })} />
              </div>
              <Input type="number" placeholder="Weekly quota (default 20)"
                value={draft.weekly_quota} onChange={(e) => setDraft({ ...draft, weekly_quota: e.target.value })} />
              <Textarea placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              <Button size="sm" onClick={save}>Save segment</Button>
            </div>
          )}
          {segments.length === 0 && !creating && (
            <div className="text-sm text-muted-foreground">
              No segments yet. Click + New to define who you&apos;re targeting.
            </div>
          )}
          {segments.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`w-full rounded border px-3 py-2 text-left text-sm ${
                selectedId === s.id ? "bg-muted" : "bg-background"
              }`}
            >
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground">
                {s.weekly_quota}/wk quota · {s.industries.length + s.role_keywords.length + s.locations.length} filters
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {selected ? (
          <>
            <Card>
              <CardHeader className="pb-2 flex items-center justify-between">
                <CardTitle className="text-lg">{selected.name}</CardTitle>
                <Button size="sm" variant="outline" onClick={() => remove(selected.id)}>
                  Archive
                </Button>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Target audience</div>
                  <div className="text-2xl font-bold">
                    {gap ? gap.matching_audience.toLocaleString() : "…"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    matching connections out of {gap ? gap.total_audience.toLocaleString() : "…"}
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Weekly quota</div>
                  <div className="text-2xl font-bold">
                    {gap ? `${gap.sent_this_week} / ${gap.weekly_quota}` : "…"}
                  </div>
                  <div className="text-xs text-muted-foreground">sent this week</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-muted-foreground">Filters</div>
                  <div className="text-sm mt-1 space-y-0.5">
                    {selected.industries.length > 0 && <div><span className="text-muted-foreground">Industries:</span> {selected.industries.join(", ")}</div>}
                    {selected.role_keywords.length > 0 && <div><span className="text-muted-foreground">Roles:</span> {selected.role_keywords.join(", ")}</div>}
                    {selected.locations.length > 0 && <div><span className="text-muted-foreground">Locations:</span> {selected.locations.join(", ")}</div>}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Prospect suggestions</CardTitle></CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">
                  Prospects sourced from competitor engagers matching this segment will appear here.
                  Fire the daily competitor-engager mining task on the Competitors tab to populate.
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              Select or create a segment on the left.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
