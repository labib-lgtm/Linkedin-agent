"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Candidate = {
  post_id: string;
  competitor_id: string | null;
  competitor_name: string;
  posted_at: string | null;
  text: string | null;
  engagement_score: number | string | null;
  media_type: string | null;
};

type Draft = {
  id: string;
  account_id: string;
  competitor_post_id: string;
  competitor_id: string | null;
  competitor_name: string;
  draft_comment: string | null;
  status: "draft" | "approved" | "sent" | "rejected";
  generated_at: string;
  approved_at: string | null;
  sent_at: string | null;
};

const STATUS_TONE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  sent: "bg-green-100 text-green-800",
  rejected: "bg-rose-100 text-rose-800",
};

export function OutreachQueue() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/outreach");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setCandidates(data.candidates ?? []);
      setDrafts(data.drafts ?? []);
    } catch (e) {
      toast.error(`Refresh failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function draft(c: Candidate) {
    setDrafting(c.post_id);
    try {
      const res = await fetch("/api/outreach/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitor_post_id: c.post_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      toast.success("Comment drafted — review below");
      await refresh();
    } catch (e) {
      toast.error(`Draft failed: ${(e as Error).message}`);
    } finally {
      setDrafting(null);
    }
  }

  async function patchDraft(id: string, patch: Partial<Draft>) {
    try {
      const res = await fetch(`/api/outreach/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...data.outbound } : d)));
      if ("draft_comment" in patch) toast.success("Comment updated");
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  }

  async function approve(id: string) {
    try {
      const res = await fetch(`/api/outreach/${id}/approve`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success("Approved — queued for next send window");
      setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...data.outbound } : d)));
    } catch (e) {
      toast.error(`Approve failed: ${(e as Error).message}`);
    }
  }

  const draftStatus = drafts.filter((d) => d.status === "draft");
  const approvedStatus = drafts.filter((d) => d.status === "approved");
  const sentStatus = drafts.filter((d) => d.status === "sent");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* LEFT: Candidates from competitor_posts */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto">
        <div className="flex items-center justify-between gap-3 sticky top-0 bg-card z-10 pb-2 border-b border-border">
          <h2 className="text-[10px] uppercase tracking-[0.18em] font-bold">
            Comment opportunities · last 14d
          </h2>
          <button
            type="button"
            onClick={refresh}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            ↻ refresh
          </button>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
        ) : candidates.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No new opportunities. Either every recent breakout is already drafted, or competitors
            haven&apos;t posted in 14 days.
          </div>
        ) : (
          candidates.map((c) => (
            <div
              key={c.post_id}
              className="rounded-lg border border-border p-3 space-y-2 hover:border-foreground/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-semibold">{c.competitor_name}</span>
                <span className="text-muted-foreground tabular-nums">
                  score {Math.round(Number(c.engagement_score ?? 0))} ·{" "}
                  {c.media_type ?? "text"}
                </span>
              </div>
              <p className="text-xs text-foreground/80 line-clamp-3 leading-snug">
                {c.text || "(no text)"}
              </p>
              <Button
                size="sm"
                onClick={() => draft(c)}
                disabled={drafting === c.post_id}
                className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90 w-full"
              >
                {drafting === c.post_id ? "Drafting…" : "Draft comment"}
              </Button>
            </div>
          ))
        )}
      </section>

      {/* RIGHT: Drafts queue (Draft → Approved → Sent) */}
      <section className="space-y-4">
        <DraftColumn
          title={`Draft · ${draftStatus.length}`}
          drafts={draftStatus}
          onPatch={patchDraft}
          onApprove={approve}
        />
        <DraftColumn
          title={`Approved · ${approvedStatus.length}`}
          drafts={approvedStatus}
          onPatch={patchDraft}
        />
        <DraftColumn title={`Sent · ${sentStatus.length}`} drafts={sentStatus} />
      </section>
    </div>
  );
}

function DraftColumn({
  title,
  drafts,
  onPatch,
  onApprove,
}: {
  title: string;
  drafts: Draft[];
  onPatch?: (id: string, patch: Partial<Draft>) => Promise<void>;
  onApprove?: (id: string) => Promise<void>;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-[10px] uppercase tracking-[0.18em] font-bold mb-3">{title}</h2>
      {drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Empty.</p>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => (
            <DraftRow
              key={d.id}
              draft={d}
              onPatch={onPatch}
              onApprove={onApprove}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DraftRow({
  draft,
  onPatch,
  onApprove,
}: {
  draft: Draft;
  onPatch?: (id: string, patch: Partial<Draft>) => Promise<void>;
  onApprove?: (id: string) => Promise<void>;
}) {
  const [text, setText] = useState(draft.draft_comment ?? "");
  // Editable while it's still a draft OR approved-but-not-yet-sent. The sender
  // reads draft_comment at send time, so edits to a queued comment take effect.
  const editable = (draft.status === "draft" || draft.status === "approved") && !!onPatch;

  return (
    <div
      className={`rounded-lg border p-2.5 space-y-1.5 ${
        draft.status === "approved"
          ? "border-blue-300 bg-blue-50/30"
          : draft.status === "sent"
            ? "border-green-300 bg-green-50/30"
            : "border-border bg-background"
      }`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-semibold truncate">{draft.competitor_name}</span>
        <span
          className={`text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${
            STATUS_TONE[draft.status] ?? "bg-muted text-muted-foreground"
          }`}
        >
          {draft.status}
        </span>
      </div>
      {editable ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== draft.draft_comment) onPatch?.(draft.id, { draft_comment: text });
          }}
          rows={3}
          className="w-full text-xs leading-snug bg-background border border-border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-foreground/30"
        />
      ) : (
        <p className="text-xs text-foreground/80 leading-snug whitespace-pre-line">
          {text || "(empty)"}
        </p>
      )}
      {draft.status === "draft" && onPatch ? (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            onClick={() => onApprove?.(draft.id)}
            disabled={!text.trim()}
            className="flex-1 bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPatch?.(draft.id, { status: "rejected" })}
            className="text-rose-700"
          >
            Reject
          </Button>
        </div>
      ) : draft.status === "approved" && onPatch ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground">
            Queued — edits save automatically
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPatch?.(draft.id, { status: "rejected" })}
            className="text-rose-700"
          >
            Reject
          </Button>
        </div>
      ) : null}
      {draft.sent_at ? (
        <div className="text-[10px] text-muted-foreground">
          sent {new Date(draft.sent_at).toLocaleString()}
        </div>
      ) : null}
    </div>
  );
}
