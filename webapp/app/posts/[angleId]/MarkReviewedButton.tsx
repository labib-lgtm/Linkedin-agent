"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { StudioAngle } from "./PostStudio";

// "Mark reviewed" with an optional takeaway. Shown in the studio header
// when status === "Posted". Calls POST /api/angles/[id]/review which
// flips status → Reviewed and writes the takeaway to audit_log as
// event_type="post_reviewed". The kanban drag-drop still works for the
// no-takeaway case; this just lets the operator capture a learning
// next to the post they're reviewing.
export function MarkReviewedButton({
  angleId,
  onMarked,
}: {
  angleId: string;
  onMarked?: (a: StudioAngle) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [takeaway, setTakeaway] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function confirm() {
    setBusy(true);
    try {
      const res = await fetch(`/api/angles/${angleId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takeaway: takeaway.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      onMarked?.(data.angle);
      toast.success(
        takeaway.trim() ? "Marked reviewed — takeaway saved" : "Marked reviewed",
      );
      setOpen(false);
      startTransition(() => router.push("/"));
    } catch (e) {
      toast.error(`Mark reviewed failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        title="Move to Learned with an optional takeaway"
      >
        Mark reviewed →
      </Button>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Mark this post reviewed</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Move it to the Learned column. Add a takeaway if anything worth
              remembering — leave blank to just archive.
            </p>
          </DialogHeader>

          <div className="mt-3 space-y-2">
            <Textarea
              value={takeaway}
              onChange={(e) => setTakeaway(e.target.value)}
              placeholder="What did this post teach? e.g. 'hook stat in slide 1 doubled saves vs prior decks'"
              rows={4}
              maxLength={1000}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !busy) {
                  e.preventDefault();
                  confirm();
                }
              }}
              className="text-sm"
            />
            <div className="text-[10px] text-muted-foreground tabular-nums text-right">
              {takeaway.length} / 1000 · ⌘↵ to confirm
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border mt-3">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={confirm}
              disabled={busy}
              className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
            >
              {busy ? "Marking…" : "Mark reviewed"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
