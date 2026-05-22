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
  done: "bg-stone-100 text-stone-600",
};

const STAGE_LABEL: Record<string, string> = {
  engaging: "Engaging",
  ready_to_invite: "Ready to invite",
  invited: "Invited",
  connected: "Connected",
  dm_sent: "DM sent",
  done: "Done",
};

export function SequenceTab() {
  const [rows, setRows] = useState<SequenceRow[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function togglePause(row: SequenceRow) {
    try {
      const res = await fetch(`/api/prospects/${row.prospect_id}/outreach`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !row.paused }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      setRows((prev) =>
        prev.map((r) => (r.id === row.id ? { ...r, paused: !r.paused } : r)),
      );
    } catch (e) {
      toast.error(`Update failed: ${(e as Error).message}`);
    }
  }

  async function remove(row: SequenceRow) {
    if (!confirm(`Remove ${row.prospect?.name ?? "this prospect"} from the sequence?`)) return;
    try {
      const res = await fetch(`/api/prospects/${row.prospect_id}/outreach`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? `HTTP ${res.status}`);
      }
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success("Removed from sequence");
    } catch (e) {
      toast.error(`Remove failed: ${(e as Error).message}`);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading sequence…</p>;
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No prospects in the sequence yet. Add them from the Prospects page using the
        &quot;+ Sequence&quot; button on a matched prospect.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Enrolled prospects warm up automatically: the bot comments on their posts (up to
        their target), then they move to <span className="font-medium">Ready to invite</span> for
        your approval. {rows.length} in sequence.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-2.5 px-3 font-semibold">Prospect</th>
              <th className="py-2.5 px-3 font-semibold">Company</th>
              <th className="py-2.5 px-3 font-semibold">Stage</th>
              <th className="py-2.5 px-3 font-semibold text-center">Comments</th>
              <th className="py-2.5 px-3 font-semibold">Last comment</th>
              <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const company =
                r.prospect?.seller?.brand_name ||
                r.prospect?.seller?.seller_name ||
                r.prospect?.seller?.business_name ||
                "—";
              return (
                <tr
                  key={r.id}
                  className={`border-b border-border last:border-0 hover:bg-muted/30 ${r.paused ? "opacity-60" : ""}`}
                >
                  <td className="py-2.5 px-3">
                    <div className="font-medium">
                      {r.prospect?.linkedin_url ? (
                        <a
                          href={r.prospect.linkedin_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
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
                  </td>
                  <td className="py-2.5 px-3 text-muted-foreground">{company}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        STAGE_TONE[r.stage] ?? "bg-gray-100 text-gray-700"
                      }`}
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
                  <td className="py-2.5 px-3 text-xs text-muted-foreground">
                    {r.last_comment_at ? shortDate(r.last_comment_at) : "—"}
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center justify-end gap-2">
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
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
