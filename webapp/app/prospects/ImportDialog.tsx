"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Progress = {
  import: {
    id: string;
    filename: string;
    row_count: number;
    enriched_count: number;
    status: "queued" | "processing" | "completed" | "failed" | "cancelled";
    error: string | null;
    completed_at: string | null;
  };
  sellers_summary: { pending: number; matched: number; no_match: number; failed: number };
};

export function ImportDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [limit, setLimit] = useState("200");
  const [busy, setBusy] = useState(false);
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function reset() {
    setFile(null);
    setLimit("200");
    setBusy(false);
    setImportId(null);
    setProgress(null);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function close() {
    if (busy && !importId) return;
    reset();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Pick a CSV file");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("limit", limit.trim() || "200");
      const res = await fetch("/api/prospects/imports", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Queued ${data.rowCount} rows for enrichment`);
      setImportId(data.importId as string);
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  // Poll progress while we have an active import.
  useEffect(() => {
    if (!importId) return;
    let cancelled = false;

    async function fetchProgress() {
      try {
        const res = await fetch(`/api/prospects/imports/${importId}`);
        const data = (await res.json()) as Progress;
        if (cancelled) return;
        setProgress(data);
        if (data.import.status === "completed" || data.import.status === "failed") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        // Soft fail — keep polling.
      }
    }

    fetchProgress();
    pollRef.current = setInterval(fetchProgress, 5000);
    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [importId]);

  const done =
    progress?.import.status === "completed" || progress?.import.status === "failed";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Import sellers</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Upload a CSV from your Amazon-seller export. Needs a <code>Seller</code> or
            <code>Business Name</code> column. Other columns (Category, Revenue, etc.) are
            optional but enrich the review view.
          </p>
        </DialogHeader>

        {!importId ? (
          <form onSubmit={submit} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="csv-file">CSV file</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="row-limit">Row limit</Label>
              <Input
                id="row-limit"
                type="number"
                min={1}
                max={1000}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                Cap at 1,000 for pilot. Default 200 for first runs — validate match quality
                before scaling.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !file}>
                {busy ? "Uploading…" : "Start enrichment"}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-2 space-y-3">
            <div className="text-xs">
              <strong>Status:</strong>{" "}
              <span
                className={
                  progress?.import.status === "completed"
                    ? "text-green-700"
                    : progress?.import.status === "failed"
                      ? "text-rose-700"
                      : "text-amber-700"
                }
              >
                {progress?.import.status ?? "queued"}
              </span>
            </div>
            {progress ? (
              <>
                <div className="text-xs">
                  <strong>Progress:</strong> {progress.import.enriched_count} /{" "}
                  {progress.import.row_count}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>Matched: <strong>{progress.sellers_summary.matched}</strong></div>
                  <div>No match: <strong>{progress.sellers_summary.no_match}</strong></div>
                  <div>Failed: <strong>{progress.sellers_summary.failed}</strong></div>
                  <div>Pending: <strong>{progress.sellers_summary.pending}</strong></div>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-lynx-green h-2 transition-all"
                    style={{
                      width: `${
                        progress.import.row_count > 0
                          ? Math.min(
                              100,
                              Math.round(
                                ((progress.sellers_summary.matched +
                                  progress.sellers_summary.no_match +
                                  progress.sellers_summary.failed) /
                                  progress.import.row_count) *
                                  100,
                              ),
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
                {progress.import.error ? (
                  <p className="text-xs text-rose-700 break-all">
                    {progress.import.error}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Starting…</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={onDone}>
                {done ? "Close & view" : "Close (run continues in background)"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
