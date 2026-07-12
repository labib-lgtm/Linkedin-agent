"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Segment schema — mirrors the columns the /api/audience/segments GET returns.
// Outbound fields (invite_template / dm_template / daily_send_cap / auto_send /
// paused_at) come from migration 031.
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
  invite_template: string | null;
  dm_template: string | null;
  dm_followup_template: string | null;
  daily_send_cap: number | null;
  auto_send: boolean | null;
  paused_at: string | null;
  pause_reason: string | null;
};

type Gap = {
  total_audience: number;
  matching_audience: number;
  weekly_quota: number;
  sent_this_week: number;
};

type QueueStatus = {
  counters: {
    sourced_today: number;
    sent_today: number;
    accepted_today: number;
    sent_14d: number;
    accepted_14d: number;
    total_sent: number;
    total_accepted: number;
  };
  rate_14d: number | null;
  recent: Array<{
    id: string;
    provider_id: string;
    full_name: string | null;
    headline: string | null;
    status: string;
    sent_at: string;
    accepted_at: string | null;
  }>;
};

interface Draft {
  name: string;
  industries: string;
  role_keywords: string;
  locations: string;
  company_size_min: string;
  company_size_max: string;
  weekly_quota: string;
  notes: string;
  invite_template: string;
  dm_template: string;
  dm_followup_template: string;
  daily_send_cap: string;
  auto_send: boolean;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  industries: "",
  role_keywords: "",
  locations: "",
  company_size_min: "",
  company_size_max: "",
  weekly_quota: "20",
  notes: "",
  invite_template: "",
  dm_template: "",
  dm_followup_template: "",
  daily_send_cap: "10",
  auto_send: false,
};

const INVITE_MAX = 200;

function segmentToDraft(s: Segment): Draft {
  return {
    name: s.name,
    industries: s.industries.join(", "),
    role_keywords: s.role_keywords.join(", "),
    locations: s.locations.join(", "),
    company_size_min: s.company_size_min?.toString() ?? "",
    company_size_max: s.company_size_max?.toString() ?? "",
    weekly_quota: s.weekly_quota.toString(),
    notes: s.notes ?? "",
    invite_template: s.invite_template ?? "",
    dm_template: s.dm_template ?? "",
    dm_followup_template: s.dm_followup_template ?? "",
    daily_send_cap: (s.daily_send_cap ?? 10).toString(),
    auto_send: s.auto_send === true,
  };
}

export function TargetingTab() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gap, setGap] = useState<Gap | null>(null);
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [mode, setMode] = useState<"idle" | "create" | "edit">("idle");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

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

  const loadQueue = useCallback(async () => {
    if (!selectedId) { setQueue(null); return; }
    const res = await fetch(`/api/audience/segments/${selectedId}/queue-status`);
    const json = await res.json();
    if (res.ok) setQueue(json);
  }, [selectedId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadGap(); }, [loadGap]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const save = useCallback(async () => {
    if (!draft.name.trim()) {
      toast.error("Name required");
      return;
    }
    if (draft.auto_send && !draft.invite_template.trim()) {
      toast.error("Auto-send needs an invite note template");
      return;
    }
    if (draft.invite_template.length > INVITE_MAX) {
      toast.error(`Invite note over ${INVITE_MAX} chars`);
      return;
    }
    setSaving(true);
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
      invite_template: draft.invite_template || null,
      dm_template: draft.dm_template || null,
      dm_followup_template: draft.dm_followup_template || null,
      daily_send_cap: Number(draft.daily_send_cap) || 10,
      auto_send: draft.auto_send,
    };
    try {
      const isEdit = mode === "edit" && selectedId;
      const url = isEdit
        ? `/api/audience/segments/${selectedId}`
        : "/api/audience/segments";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Save failed");
        return;
      }
      toast.success(isEdit ? "Segment updated" : "Segment created");
      if (!isEdit && json.id) setSelectedId(json.id);
      setDraft(EMPTY_DRAFT);
      setMode("idle");
      void load();
    } finally {
      setSaving(false);
    }
  }, [draft, mode, selectedId, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm("Archive this segment?")) return;
    const res = await fetch(`/api/audience/segments/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Archived");
      if (selectedId === id) setSelectedId(null);
      void load();
    }
  }, [load, selectedId]);

  const resume = useCallback(async () => {
    if (!selectedId) return;
    const res = await fetch(`/api/audience/segments/${selectedId}/resume`, { method: "POST" });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error ?? "Resume failed");
      return;
    }
    toast.success("Segment resumed");
    void load();
    void loadQueue();
  }, [selectedId, load, loadQueue]);

  const startEdit = useCallback(() => {
    const selected = segments.find((s) => s.id === selectedId);
    if (!selected) return;
    setDraft(segmentToDraft(selected));
    setMode("edit");
  }, [segments, selectedId]);

  const startCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setMode("create");
  }, []);

  const cancelEdit = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setMode("idle");
  }, []);

  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const isPaused = selected?.paused_at != null;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader className="pb-2 flex items-center justify-between">
          <CardTitle className="text-sm">Segments</CardTitle>
          <Button size="sm" onClick={mode === "idle" ? startCreate : cancelEdit}>
            {mode === "idle" ? "+ New" : "Close"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {mode !== "idle" && (
            <div className="space-y-2 rounded border p-3">
              <div className="text-xs font-medium">
                {mode === "edit" ? "Edit segment" : "New segment"}
              </div>
              <Input placeholder="Name (e.g. US/UK Amazon founders)"
                value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <Input placeholder="Industries (comma-separated)"
                value={draft.industries} onChange={(e) => setDraft({ ...draft, industries: e.target.value })} />
              <Input placeholder="Role keywords (founder, ceo, owner, ...)"
                value={draft.role_keywords} onChange={(e) => setDraft({ ...draft, role_keywords: e.target.value })} />
              <Input placeholder="Locations (United States, United Kingdom, ...)"
                value={draft.locations} onChange={(e) => setDraft({ ...draft, locations: e.target.value })} />
              <div className="flex gap-2">
                <Input type="number" placeholder="Size min"
                  value={draft.company_size_min} onChange={(e) => setDraft({ ...draft, company_size_min: e.target.value })} />
                <Input type="number" placeholder="Size max"
                  value={draft.company_size_max} onChange={(e) => setDraft({ ...draft, company_size_max: e.target.value })} />
              </div>

              <div className="pt-2 mt-2 border-t space-y-2">
                <div className="text-xs font-medium">Outbound engine</div>
                <div>
                  <Textarea
                    placeholder="Invite note (200 char cap). Use {first_name} for personalization."
                    value={draft.invite_template}
                    onChange={(e) => setDraft({ ...draft, invite_template: e.target.value.slice(0, INVITE_MAX) })}
                    rows={3}
                  />
                  <div className="text-xs text-muted-foreground text-right">
                    {draft.invite_template.length} / {INVITE_MAX}
                  </div>
                </div>
                <Textarea
                  placeholder="First DM after acceptance"
                  value={draft.dm_template}
                  onChange={(e) => setDraft({ ...draft, dm_template: e.target.value })}
                  rows={4}
                />
                <Textarea
                  placeholder="Follow-up DM (T+4d if no reply)"
                  value={draft.dm_followup_template}
                  onChange={(e) => setDraft({ ...draft, dm_followup_template: e.target.value })}
                  rows={3}
                />
                <div className="flex items-center gap-2">
                  <Input type="number" placeholder="Daily send cap"
                    min={1} max={20}
                    value={draft.daily_send_cap}
                    onChange={(e) => setDraft({ ...draft, daily_send_cap: e.target.value })}
                    className="max-w-[100px]"
                  />
                  <label className="text-xs flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draft.auto_send}
                      onChange={(e) => setDraft({ ...draft, auto_send: e.target.checked })}
                    />
                    Auto-send enabled
                  </label>
                </div>
              </div>

              <Input type="number" placeholder="Weekly quota (default 20)"
                value={draft.weekly_quota} onChange={(e) => setDraft({ ...draft, weekly_quota: e.target.value })} />
              <Textarea placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} />
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? "Saving…" : mode === "edit" ? "Update" : "Save segment"}
                </Button>
                <Button size="sm" variant="outline" onClick={cancelEdit}>Cancel</Button>
              </div>
            </div>
          )}
          {segments.length === 0 && mode === "idle" && (
            <div className="text-sm text-muted-foreground">
              No segments yet. Click + New to define who you&apos;re targeting.
            </div>
          )}
          {segments.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSelectedId(s.id); if (mode !== "idle") cancelEdit(); }}
              className={`w-full rounded border px-3 py-2 text-left text-sm ${
                selectedId === s.id ? "bg-muted" : "bg-background"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="font-medium">{s.name}</div>
                {s.paused_at && <span className="text-xs rounded bg-yellow-100 text-yellow-900 px-1.5 py-0.5">paused</span>}
                {s.auto_send && !s.paused_at && <span className="text-xs rounded bg-green-100 text-green-900 px-1.5 py-0.5">auto</span>}
              </div>
              <div className="text-xs text-muted-foreground">
                {s.daily_send_cap ?? 10}/day · {s.industries.length + s.role_keywords.length + s.locations.length} filters
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {selected ? (
          <>
            {isPaused && (
              <Card className="border-yellow-400">
                <CardContent className="p-3 flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <div className="font-medium text-yellow-900">Segment paused</div>
                    <div className="text-xs text-yellow-800">
                      {selected.pause_reason ?? "Manual pause"}
                    </div>
                  </div>
                  <Button size="sm" onClick={resume}>Resume</Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="pb-2 flex items-center justify-between">
                <CardTitle className="text-lg">{selected.name}</CardTitle>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={startEdit}>Edit</Button>
                  <Button size="sm" variant="outline" onClick={() => remove(selected.id)}>Archive</Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-4">
                <Stat
                  label="Target audience"
                  value={gap ? gap.matching_audience.toLocaleString() : "…"}
                  hint={gap ? `of ${gap.total_audience.toLocaleString()} connections` : ""}
                />
                <Stat
                  label="Daily cap"
                  value={selected.daily_send_cap ?? 10}
                  hint={selected.auto_send ? "auto-send on" : "auto-send off"}
                />
                <Stat
                  label="Sourced today"
                  value={queue?.counters.sourced_today ?? 0}
                  hint={queue ? `${queue.counters.sent_today} sent, ${queue.counters.accepted_today} accepted` : ""}
                />
                <Stat
                  label="14-day accept rate"
                  value={queue?.rate_14d != null ? `${Math.round(queue.rate_14d * 100)}%` : "—"}
                  hint={queue ? `${queue.counters.accepted_14d} / ${queue.counters.sent_14d}` : ""}
                />
              </CardContent>
              <CardContent className="pt-0">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-xs uppercase text-muted-foreground">Filters</div>
                    <div className="text-sm mt-1 space-y-0.5">
                      {selected.industries.length > 0 && <div><span className="text-muted-foreground">Industries:</span> {selected.industries.join(", ")}</div>}
                      {selected.role_keywords.length > 0 && <div><span className="text-muted-foreground">Roles:</span> {selected.role_keywords.join(", ")}</div>}
                      {selected.locations.length > 0 && <div><span className="text-muted-foreground">Locations:</span> {selected.locations.join(", ")}</div>}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs uppercase text-muted-foreground">Templates</div>
                    <div className="text-xs mt-1 space-y-1">
                      <div className="line-clamp-2"><span className="text-muted-foreground">Invite:</span> {selected.invite_template || "(none — segment will skip until set)"}</div>
                      <div className="line-clamp-2"><span className="text-muted-foreground">DM:</span> {selected.dm_template || "(none)"}</div>
                      <div className="line-clamp-2"><span className="text-muted-foreground">Followup:</span> {selected.dm_followup_template || "(none)"}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Recent candidates ({queue?.recent.length ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="max-h-[40vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                        <th className="p-2">Name</th>
                        <th className="p-2">Headline</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Sent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(!queue || queue.recent.length === 0) && (
                        <tr>
                          <td colSpan={4} className="p-4 text-center text-muted-foreground">
                            No candidates yet. The daily source task queues 10 per day when auto-send is on.
                          </td>
                        </tr>
                      )}
                      {queue?.recent.map((r) => (
                        <tr key={r.id} className="border-b align-top">
                          <td className="p-2 font-medium">{r.full_name ?? "(no name)"}</td>
                          <td className="p-2 max-w-xs">
                            <div className="line-clamp-2 text-xs">{r.headline ?? "-"}</div>
                          </td>
                          <td className="p-2 text-xs">{r.status}</td>
                          <td className="p-2 text-xs">{new Date(r.sent_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{typeof value === "number" ? value.toLocaleString() : value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
