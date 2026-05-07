"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NewMagnetDialog, type LeadMagnet } from "./NewMagnetDialog";

// Settings → Lead Magnets. Library of reusable assets the agent DMs to
// commenters who hit the CTA keyword. Per-account: scoped by the active
// account cookie (lynx_active_account).
export function LeadMagnetsPanel() {
  const [magnets, setMagnets] = useState<LeadMagnet[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/lead-magnets");
      const d = (await res.json()) as { magnets?: LeadMagnet[] };
      setMagnets(d.magnets ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>Lead magnet library</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Save links or files once, attach to any post that promises them. The Phase F
              engagement loop substitutes <code className="px-1 rounded bg-muted text-[10px]">{"{{lead_magnet_url}}"}</code>
              in your DM template with the picked magnet&apos;s URL when commenters trigger the CTA keyword.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            + New magnet
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading magnets…</p>
          ) : magnets.length === 0 ? (
            <div className="text-sm text-muted-foreground border border-dashed border-border rounded-lg p-6 text-center">
              No magnets yet. Click <strong>+ New magnet</strong> to add your first one.
            </div>
          ) : (
            <div className="space-y-2">
              {magnets.map((m) => (
                <MagnetRow key={m.id} magnet={m} onChanged={refresh} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <NewMagnetDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => refresh()}
      />
    </div>
  );
}

function MagnetRow({
  magnet,
  onChanged,
}: {
  magnet: LeadMagnet;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(magnet.label);
  const [url, setUrl] = useState(magnet.url);
  const [description, setDescription] = useState(magnet.description ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/settings/lead-magnets/${magnet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim() || magnet.label,
          url: url.trim() || magnet.url,
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success("Saved");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive "${magnet.label}"? Posts already attached keep their URL; the magnet just hides from the picker.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/settings/lead-magnets/${magnet.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success("Archived");
      onChanged();
    } catch (e) {
      toast.error(`Archive failed: ${(e as Error).message}`);
    }
  }

  const shortUrl = magnet.url.length > 60 ? `${magnet.url.slice(0, 57)}…` : magnet.url;

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      {editing ? (
        <div className="space-y-2">
          <div>
            <Label className="text-[10px] uppercase">Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label className="text-[10px] uppercase">
              URL {magnet.kind === "file" ? "(bucket-hosted file)" : ""}
            </Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} type="url" />
            {magnet.kind === "file" ? (
              <p className="text-[10px] text-muted-foreground mt-1">
                Editing this URL doesn&apos;t move the file. To replace the file, archive this
                magnet and create a new one.
              </p>
            ) : null}
          </div>
          <div>
            <Label className="text-[10px] uppercase">Internal note</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span
            className={`text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
              magnet.kind === "file"
                ? "bg-amber-100 text-amber-800"
                : "bg-lynx-green/20 text-lynx-charcoal"
            }`}
          >
            {magnet.kind}
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{magnet.label}</div>
            <a
              href={magnet.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-muted-foreground hover:text-foreground font-mono break-all"
            >
              {shortUrl}
            </a>
            {magnet.description ? (
              <p className="text-[11px] text-muted-foreground mt-1">{magnet.description}</p>
            ) : null}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-rose-700"
              onClick={archive}
            >
              Archive
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
