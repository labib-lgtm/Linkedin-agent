"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PILLAR_VALUES } from "@/lib/constants";

type Creative = {
  path: string;
  format: "image" | "carousel";
  mime: string;
  filename: string;
  bytes: number;
  previewUrl: string | null;
};

const ACCEPTED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
];

function isAcceptedMime(mime: string): boolean {
  return ACCEPTED_MIMES.includes(mime.toLowerCase());
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const HOOK_STYLES = [
  { value: "question", label: "Question" },
  { value: "stat", label: "Stat" },
  { value: "contrarian", label: "Contrarian" },
  { value: "story", label: "Story" },
  { value: "how-to", label: "How-to" },
  { value: "list", label: "List" },
] as const;
type HookStyle = (typeof HOOK_STYLES)[number]["value"];

const CHAR_PRESETS = [
  { value: 300, label: "Short", help: "Punchy reaction · 300" },
  { value: 800, label: "Medium", help: "Sweet spot · 800" },
  { value: 1500, label: "Long", help: "Thought piece · 1500" },
] as const;

export default function QuickPostPage() {
  const router = useRouter();

  // Compose form state
  const [brief, setBrief] = useState("");
  const [hookStyle, setHookStyle] = useState<HookStyle>("question");
  const [charLimit, setCharLimit] = useState(800);
  const [pillar, setPillar] = useState("");
  const [ctaKeyword, setCtaKeyword] = useState("");

  // AI output + save flow state
  const [composing, setComposing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Creative upload state
  const [creative, setCreative] = useState<Creative | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs leak unless revoked when replaced or on unmount.
  useEffect(() => {
    return () => {
      if (creative?.previewUrl) URL.revokeObjectURL(creative.previewUrl);
    };
  }, [creative?.previewUrl]);

  async function uploadFile(file: File) {
    if (!isAcceptedMime(file.type)) {
      toast.error(`'${file.type || "unknown"}' is not a supported file type.`);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/angles/quick-upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      // Revoke previous preview URL before swapping.
      if (creative?.previewUrl) URL.revokeObjectURL(creative.previewUrl);
      const previewUrl = data.format === "image" ? URL.createObjectURL(file) : null;
      setCreative({
        path: data.path,
        format: data.format,
        mime: data.mime,
        filename: data.filename,
        bytes: data.bytes,
        previewUrl,
      });
      toast.success(`Attached: ${data.filename} (${formatBytes(data.bytes)})`);
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function clearCreative() {
    if (creative?.previewUrl) URL.revokeObjectURL(creative.previewUrl);
    setCreative(null);
  }

  // Listen for paste events anywhere on the page so the user can Cmd+V an
  // image from their clipboard (Slack screenshot, Figma export, etc).
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file && isAcceptedMime(file.type)) {
            e.preventDefault();
            void uploadFile(file);
            return;
          }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-suggested angle id (YYYY-WNN-AXX). Pre-loaded once so Save can fire
  // without waiting for a network round trip.
  const [angleId, setAngleId] = useState("");
  const [weekAssigned, setWeekAssigned] = useState("");
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

  async function compose() {
    setError("");
    if (brief.trim().length < 5) {
      setError("Brief is too short. Type at least a sentence or two of what the post is about.");
      return;
    }
    setComposing(true);
    try {
      const res = await fetch("/api/angles/quick-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: brief.trim(),
          hook_style: hookStyle,
          char_limit: charLimit,
          pillar: pillar || null,
          cta_keyword: ctaKeyword.trim().toUpperCase() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      const body = (data?.body ?? "").trim();
      if (!body) {
        setError("The drafter returned an empty body. Try expanding the brief or picking a different hook style.");
        return;
      }
      setDraftBody(body);
      if (data.over_cap) {
        toast.warning(
          `Drafter couldn't trim under the cap (${data.character_count} of ${charLimit}). Edit below or click Compose again.`,
        );
      } else {
        toast.success(`Composed in ${data.character_count} chars`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComposing(false);
    }
  }

  async function saveAsDraft() {
    setError("");
    if (!draftBody.trim()) {
      setError("Nothing to save — compose a body first.");
      return;
    }
    if (!angleId.trim()) {
      setError("angle_id missing. Refresh the page so the next-id fetch can complete.");
      return;
    }
    setSaving(true);
    try {
      // Step 1 — create the angle row. Use the brief as the hook_seed so the
      // operator can see what they originally typed when reviewing later. Set
      // format based on whether a creative was uploaded.
      const targetFormat: "text" | "image" | "carousel" =
        creative?.format ?? "text";
      const createRes = await fetch("/api/angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          angle_id: angleId.trim(),
          status: "Drafted",
          pillar: pillar || null,
          format: targetFormat,
          hook_seed: brief.trim().slice(0, 4000),
          cta_keyword: ctaKeyword.trim().toUpperCase() || null,
          week_assigned: weekAssigned || null,
        }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) {
        throw new Error(createData?.error ?? `Create failed (${createRes.status})`);
      }

      // Step 2 — patch with the composed body + any uploaded creative path.
      // (POST /api/angles doesn't accept these fields in its allow-list; PATCH does.)
      const patch: Record<string, unknown> = { draft_body: draftBody.trim() };
      if (creative?.format === "image") {
        patch.slide_image_paths = { "1": creative.path };
      } else if (creative?.format === "carousel") {
        patch.carousel_pdf_path = creative.path;
      }
      const patchRes = await fetch(`/api/angles/${encodeURIComponent(angleId.trim())}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!patchRes.ok) {
        const patchData = await patchRes.json().catch(() => ({}));
        throw new Error(patchData?.error ?? `Patch failed (${patchRes.status})`);
      }

      toast.success("Saved as Drafted");
      router.push(`/angles/${angleId.trim()}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const overCap = draftBody.length > charLimit;
  const charCount = draftBody.length;

  return (
    <div className="container-tight py-6 sm:py-8 max-w-2xl">
      <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight mb-1">
        Quick post
      </h1>
      <p className="text-sm text-muted-foreground mb-6">
        Give the AI a brief plus your hook style and character cap; get a polished post body
        in your voice. Works for any topic — client wins, strategy takes, lessons, observations.
      </p>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Compose</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="brief">Brief / context</Label>
            <Textarea
              id="brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={5}
              placeholder="e.g. doubled ROAS from 4x to 8x in 60 days for a $3M pet brand. Cut 32% of branded keywords, shifted budget into sponsored display retargeting, fixed listing variation hierarchy."
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="hook_style">Hook style</Label>
              <select
                id="hook_style"
                value={hookStyle}
                onChange={(e) => setHookStyle(e.target.value as HookStyle)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {HOOK_STYLES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pillar">Pillar (optional)</Label>
              <select
                id="pillar"
                value={pillar}
                onChange={(e) => setPillar(e.target.value)}
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
          </div>

          <div className="space-y-2">
            <Label>Character cap</Label>
            <div className="flex flex-wrap gap-2">
              {CHAR_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setCharLimit(p.value)}
                  className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                    charLimit === p.value
                      ? "bg-lynx-green text-lynx-charcoal border-lynx-green"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {p.label} · {p.value}
                </button>
              ))}
              <div className="inline-flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Custom</span>
                <Input
                  type="number"
                  min={60}
                  max={3000}
                  value={charLimit}
                  onChange={(e) => setCharLimit(Math.max(60, Math.min(3000, Number(e.target.value) || 0)))}
                  className="h-8 w-24 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cta_keyword">CTA keyword (optional)</Label>
            <Input
              id="cta_keyword"
              value={ctaKeyword}
              onChange={(e) => setCtaKeyword(e.target.value.toUpperCase())}
              placeholder="AUDIT"
              className="uppercase"
            />
          </div>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <div className="flex justify-end">
            <Button
              type="button"
              variant="accent"
              onClick={compose}
              disabled={composing || brief.trim().length < 5}
            >
              {composing ? "Composing…" : draftBody ? "Re-compose" : "Compose"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Attach creative (optional)</CardTitle>
            {creative ? (
              <button
                type="button"
                onClick={clearCreative}
                className="text-xs text-rose-700 hover:underline"
              >
                Remove
              </button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {!creative ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void uploadFile(f);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
                dragOver
                  ? "border-lynx-green bg-lynx-green/10"
                  : "border-border hover:border-foreground/30 hover:bg-muted/40"
              }`}
            >
              <p className="text-sm font-medium">
                {uploading ? "Uploading…" : "Drop a file, click to browse, or paste (Cmd+V)"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Image: PNG, JPG, WebP (≤ 8 MB) → posts as a single-image post.<br />
                Carousel: PDF (≤ 80 MB) → posts as a document carousel.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void uploadFile(f);
                }}
              />
            </div>
          ) : (
            <div className="flex items-start gap-4">
              {creative.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={creative.previewUrl}
                  alt={creative.filename}
                  className="w-32 h-32 object-cover rounded border border-border"
                />
              ) : (
                <div className="w-32 h-32 rounded border border-border flex items-center justify-center bg-muted">
                  <span className="text-3xl">📄</span>
                </div>
              )}
              <div className="flex-1 min-w-0 text-sm space-y-1">
                <div className="font-medium truncate">{creative.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {creative.mime} · {formatBytes(creative.bytes)}
                </div>
                <div className="text-xs">
                  Will publish as a{" "}
                  <span className="font-semibold">
                    {creative.format === "image" ? "single-image" : "carousel PDF"}
                  </span>{" "}
                  post.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {draftBody ? (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Draft body</CardTitle>
              <span
                className={`text-xs tabular-nums ${
                  overCap ? "text-red-700 font-semibold" : "text-muted-foreground"
                }`}
              >
                {charCount} / {charLimit}
                {overCap ? " (over cap)" : ""}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              rows={Math.min(20, Math.max(6, Math.ceil(draftBody.length / 80)))}
              className="font-mono text-sm leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Angle ID: <span className="font-mono">{angleId || "…"}</span> · Saves as
                Drafted{creative ? ` with ${creative.format} attached` : ""}. Publish from the
                angle page.
              </p>
              <Button type="button" variant="accent" onClick={saveAsDraft} disabled={saving}>
                {saving ? "Saving…" : "Save & open angle"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
