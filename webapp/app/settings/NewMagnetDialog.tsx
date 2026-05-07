"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type LeadMagnet = {
  id: string;
  account_id: string;
  label: string;
  kind: "link" | "file";
  url: string;
  file_path: string | null;
  description: string | null;
  created_at: string;
  archived_at: string | null;
};

// Shared modal — reused from Settings → Lead Magnets and from the
// per-post picker's "+ New magnet" shortcut. Returns the created magnet
// row to the caller via onCreated.
export function NewMagnetDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (magnet: LeadMagnet) => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"link" | "file">("link");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setLabel("");
    setKind("link");
    setUrl("");
    setDescription("");
    setFile(null);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) {
      toast.error("Label is required");
      return;
    }
    setBusy(true);
    try {
      let finalUrl = url.trim();
      let filePath: string | null = null;

      if (kind === "file") {
        if (!file) throw new Error("Pick a file to upload");
        const form = new FormData();
        form.append("file", file);
        const upRes = await fetch("/api/settings/lead-magnets/upload", {
          method: "POST",
          body: form,
        });
        const upData = await upRes.json();
        if (!upRes.ok) {
          throw new Error(upData?.message ?? upData?.error ?? `HTTP ${upRes.status}`);
        }
        finalUrl = upData.public_url as string;
        filePath = upData.file_path as string;
      } else {
        if (!finalUrl) throw new Error("URL is required for link magnets");
      }

      const res = await fetch("/api/settings/lead-magnets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          kind,
          url: finalUrl,
          file_path: filePath,
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success(`Saved "${label.trim()}"`);
      onCreated(data.magnet as LeadMagnet);
      reset();
      onClose();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">New lead magnet</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Give it a label, pick link or file, save once. Then attach to any post that
            promises this resource — the agent DMs the URL to commenters automatically.
          </p>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="lm-label">Label</Label>
            <Input
              id="lm-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Conversion Audit Framework"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Kind
            </Label>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setKind("link")}
                className={`px-3 py-1.5 rounded text-[12px] font-medium border transition-colors ${
                  kind === "link"
                    ? "bg-lynx-green text-lynx-charcoal border-lynx-green"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                Link
              </button>
              <button
                type="button"
                onClick={() => setKind("file")}
                className={`px-3 py-1.5 rounded text-[12px] font-medium border transition-colors ${
                  kind === "file"
                    ? "bg-lynx-green text-lynx-charcoal border-lynx-green"
                    : "bg-background border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                File upload
              </button>
            </div>
          </div>

          {kind === "link" ? (
            <div className="space-y-1.5">
              <Label htmlFor="lm-url">URL</Label>
              <Input
                id="lm-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://docs.google.com/..."
                type="url"
                required
              />
              <p className="text-[10px] text-muted-foreground">
                Use a public link the recipient can open without auth (Google Doc set to
                &quot;anyone with link&quot;, Notion public page, hosted PDF, Loom, Calendly, etc.).
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="lm-file">File</Label>
              <Input
                id="lm-file"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.webp,.mp4,.zip"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                required
              />
              <p className="text-[10px] text-muted-foreground">
                PDF, PNG, JPEG, WebP, MP4, or ZIP. Max 25 MB. Stored in the public
                <code className="px-1 mx-1 rounded bg-muted text-[10px]">lead-magnets</code>
                bucket — don&apos;t upload gated content.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="lm-desc">Internal note (optional)</Label>
            <Textarea
              id="lm-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this magnet is and which post types it pairs with"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !label.trim()}>
              {busy ? "Saving…" : "Save magnet"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
