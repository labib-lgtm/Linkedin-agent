"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { shortDate } from "@/lib/utils";

type Seller = {
  seller_name: string | null;
  brand_name: string | null;
  business_name: string | null;
  linkedin_company_url: string | null;
};

type SequenceRow = {
  id: string;
  prospect_id: string;
  stage: string;
  paused: boolean;
  comments_made: number;
  comments_target: number;
  last_comment_at: string | null;
  enrolled_at: string;
  invite_message: string | null;
  invite_approved: boolean;
  invite_sent_at: string | null;
  connected_at: string | null;
  dm_text: string | null;
  dm_approved: boolean;
  dm_sent_at: string | null;
  replied_at: string | null;
  reply_snippet: string | null;
  followups_sent: number;
  prospect: {
    id: string;
    name: string | null;
    headline: string | null;
    linkedin_url: string | null;
    status: string | null;
    seller: Seller | null;
  } | null;
};

const STAGE_TONE: Record<string, string> = {
  engaging: "bg-blue-100 text-blue-800",
  ready_to_invite: "bg-violet-100 text-violet-800",
  invited: "bg-amber-100 text-amber-800",
  connected: "bg-cyan-100 text-cyan-800",
  dm_sent: "bg-green-100 text-green-800",
  responded: "bg-emerald-200 text-emerald-900",
  done: "bg-stone-100 text-stone-600",
};

const STAGE_LABEL: Record<string, string> = {
  engaging: "Engaging",
  ready_to_invite: "Ready to invite",
  invited: "Invited",
  connected: "Connected",
  dm_sent: "DM sent",
  responded: "Replied",
  done: "Done",
};

// Stages with an operator action available behind the expand chevron.
const ACTIONABLE = new Set(["ready_to_invite", "connected"]);

export function SequenceTab() {
  const [rows, setRows] = useState<SequenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [stageFilter, setStageFilter] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/prospects/sequence");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(data.rows ?? []);
    } catch (e) {
      toast.error(`Load failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function patchRow(id: string, patch: Partial<SequenceRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  async function togglePause(row: SequenceRow) {
    try {
      const res = await fetch(`/api/prospects/${row.prospect_id}/outreach`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !row.paused }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      patchRow(row.id, { paused: !row.paused });
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  }

  async function remove(row: SequenceRow) {
    if (!confirm(`Remove ${row.prospect?.name ?? "this prospect"} from the sequence?`)) return;
    try {
      const res = await fetch(`/api/prospects/${row.prospect_id}/outreach`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Removed from sequence");
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`);
    }
  }

  async function draft(row: SequenceRow, kind: "invite" | "dm") {
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const res = await fetch(`/api/prospects/${row.prospect_id}/outreach/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      patchRow(row.id, kind === "invite" ? { invite_message: data.text } : { dm_text: data.text });
    } catch (e) {
      toast.error(`Draft failed: ${(e as Error).message}`);
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  }

  async function approve(row: SequenceRow, kind: "invite" | "dm") {
    const text = kind === "invite" ? row.invite_message : row.dm_text;
    if (!text || !text.trim()) {
      toast.error("Draft something first");
      return;
    }
    setBusy((b) => ({ ...b, [row.id]: true }));
    try {
      const res = await fetch(`/api/prospects/${row.prospect_id}/outreach`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          kind === "invite"
            ? { invite_message: text, invite_approved: true }
            : { dm_text: text, dm_approved: true },
        ),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      patchRow(row.id, kind === "invite" ? { invite_approved: true } : { dm_approved: true });
      toast.success(kind === "invite" ? "Invite approved — queued to send" : "DM approved — queued to send");
    } catch (e) {
      toast.error(`Approve failed: ${(e as Error).message}`);
    } finally {
      setBusy((b) => ({ ...b, [row.id]: false }));
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading sequence…</p>;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No prospects in the sequence yet. Add them from the Prospects page using the
        &quot;+ Sequence&quot; button on a matched prospect.
      </p>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (stageFilter === "__action") {
      if (!ACTIONABLE.has(r.stage)) return false;
    } else if (stageFilter && r.stage !== stageFilter) {
      return false;
    }
    if (q) {
      const name = (r.prospect?.name ?? "").toLowerCase();
      const company = (
        r.prospect?.seller?.brand_name ||
        r.prospect?.seller?.seller_name ||
        r.prospect?.seller?.business_name ||
        ""
      ).toLowerCase();
      if (!name.includes(q) && !company.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Comments auto-send to warm prospects up. Connection requests and DMs wait for your
        approval — expand a <span className="font-medium">Ready to invite</span> or{" "}
        <span className="font-medium">Connected</span> row to review and approve.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={stageFilter}
          onChange={(e) => setStageFilter(e.target.value)}
          className="text-sm bg-background border border-border rounded px-2 py-1.5"
        >
          <option value="">All stages</option>
          <option value="__action">Needs action</option>
          <option value="engaging">Engaging</option>
          <option value="ready_to_invite">Ready to invite</option>
          <option value="invited">Invited</option>
          <option value="connected">Connected</option>
          <option value="dm_sent">DM sent</option>
          <option value="responded">Replied</option>
          <option value="done">Done</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or company…"
          className="text-sm bg-background border border-border rounded px-2 py-1.5 min-w-[200px]"
        />
        <span className="text-[11px] text-muted-foreground">
          {filtered.length === rows.length
            ? `${rows.length} in sequence`
            : `${filtered.length} of ${rows.length}`}
        </span>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No prospects match this filter.</p>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2.5 px-3 font-semibold w-6"></th>
              <th className="py-2.5 px-3 font-semibold">Prospect</th>
              <th className="py-2.5 px-3 font-semibold">Company</th>
              <th className="py-2.5 px-3 font-semibold">Stage</th>
              <th className="py-2.5 px-3 font-semibold text-center">Comments</th>
              <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const company =
                r.prospect?.seller?.brand_name ||
                r.prospect?.seller?.seller_name ||
                r.prospect?.seller?.business_name ||
                "—";
              const actionable = ACTIONABLE.has(r.stage);
              const isOpen = !!expanded[r.id];
              return (
                <>
                  <tr
                    key={r.id}
                    className={`border-b border-border hover:bg-muted/30 ${r.paused ? "opacity-60" : ""} ${actionable ? "cursor-pointer" : ""}`}
                    onClick={
                      actionable
                        ? () => setExpanded((e) => ({ ...e, [r.id]: !e[r.id] }))
                        : undefined
                    }
                  >
                    <td className="py-2.5 px-3 text-center text-muted-foreground">
                      {actionable ? (isOpen ? "▾" : "▸") : ""}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium">
                        {r.prospect?.linkedin_url ? (
                          <a
                            href={r.prospect.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {r.prospect?.name ?? "—"}
                          </a>
                        ) : (
                          (r.prospect?.name ?? "—")
                        )}
                      </div>
                      {r.prospect?.headline ? (
                        <div className="text-[11px] text-muted-foreground line-clamp-1">
                          {r.prospect.headline}
                        </div>
                      ) : null}
                      {r.stage === "responded" && r.reply_snippet ? (
                        <div className="mt-1 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-1">
                          <span className="font-semibold">Replied:</span> {r.reply_snippet}
                          {r.prospect?.linkedin_url ? (
                            <>
                              {" "}
                              <a
                                href={r.prospect.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                open chat
                              </a>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                      {r.stage === "dm_sent" && r.followups_sent > 0 ? (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          followed up · awaiting reply
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">{company}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAGE_TONE[r.stage] ?? "bg-gray-100 text-gray-700"}`}
                      >
                        {STAGE_LABEL[r.stage] ?? r.stage}
                      </span>
                      {r.paused ? (
                        <span className="ml-1.5 text-[10px] text-muted-foreground">paused</span>
                      ) : null}
                    </td>
                    <td className="py-2.5 px-3 text-center tabular-nums">
                      {r.comments_made} / {r.comments_target}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => togglePause(r)}
                          className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
                        >
                          {r.paused ? "Resume" : "Pause"}
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(r)}
                          className="text-xs px-2 py-1 rounded text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                  {actionable && isOpen ? (
                    <tr className="border-b border-border bg-muted/20">
                      <td></td>
                      <td colSpan={5} className="px-3 py-3">
                        {r.stage === "ready_to_invite" ? (
                          <ReviewPanel
                            label="Connection note"
                            hint="Sent with the connection request (LinkedIn caps notes ~200 chars)."
                            value={r.invite_message ?? ""}
                            approved={r.invite_approved}
                            busy={!!busy[r.id]}
                            onChange={(v) => patchRow(r.id, { invite_message: v })}
                            onDraft={() => draft(r, "invite")}
                            onApprove={() => approve(r, "invite")}
                            approvedLabel="Invite approved — queued to send"
                          />
                        ) : (
                          <ReviewPanel
                            label="First DM"
                            hint="Sent after they accept your connection request."
                            value={r.dm_text ?? ""}
                            approved={r.dm_approved}
                            busy={!!busy[r.id]}
                            onChange={(v) => patchRow(r.id, { dm_text: v })}
                            onDraft={() => draft(r, "dm")}
                            onApprove={() => approve(r, "dm")}
                            approvedLabel="DM approved — queued to send"
                          />
                        )}
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

function ReviewPanel({
  label,
  hint,
  value,
  approved,
  busy,
  onChange,
  onDraft,
  onApprove,
  approvedLabel,
}: {
  label: string;
  hint: string;
  value: string;
  approved: boolean;
  busy: boolean;
  onChange: (v: string) => void;
  onDraft: () => void;
  onApprove: () => void;
  approvedLabel: string;
}) {
  if (approved) {
    return (
      <div className="text-sm">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
        <div className="rounded border border-lynx-green/40 bg-lynx-green/10 p-2 text-sm whitespace-pre-wrap">
          {value}
        </div>
        <p className="text-xs text-lynx-charcoal/70 mt-1.5">✓ {approvedLabel}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={label === "First DM" ? 4 : 2}
        placeholder="Click Draft to generate, then edit…"
        className="w-full text-sm bg-background border border-border rounded px-2 py-1.5"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDraft}
          disabled={busy}
          className="text-xs px-2.5 py-1 rounded border border-border hover:bg-muted disabled:opacity-50"
        >
          {busy ? "…" : value ? "Re-draft" : "Draft"}
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={busy || !value.trim()}
          className="text-xs px-2.5 py-1 rounded bg-lynx-green text-lynx-charcoal font-semibold hover:bg-lynx-green/90 disabled:opacity-50"
        >
          Approve &amp; queue
        </button>
      </div>
    </div>
  );
}
