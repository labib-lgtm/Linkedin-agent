"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Slide } from "./SlideCard";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "post-assets";

export type Asset = {
  id: string;
  slide_n: number;
  variant_n: number;
  storage_path: string;
  brand_score: number | null;
  brand_score_detail: { closest_palette_key?: string; distance?: number } | null;
  picked_at: string | null;
  generated_at: string;
};

function publicUrl(path: string | null): string | null {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

// 2x2 picker for the 4 most-recent variants of a slide.
//
// Polling: after kicking off a Trigger.dev run we poll /assets every 4s
// until we either see 4 variants for this slide or 90s elapses.
export function SlideVariantPicker({
  open,
  slide,
  angleId,
  onClose,
  onPicked,
}: {
  open: boolean;
  slide: Slide | null;
  angleId: string;
  onClose: () => void;
  onPicked: (updatedAngle: { slide_image_paths: Record<string, string> } & Record<string, unknown>) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  async function refresh() {
    if (!slide) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts/${angleId}/assets`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const all = (data.assets ?? []) as Asset[];
      // Most-recent 4 for this slide.
      const recent = all
        .filter((a) => a.slide_n === slide.n)
        .sort((a, b) => (a.generated_at < b.generated_at ? 1 : -1))
        .slice(0, 4);
      setAssets(recent);
    } catch (e) {
      toast.error(`Refresh failed: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && slide) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slide?.n]);

  async function generate() {
    if (!slide) return;
    setGenerating(true);
    try {
      const res = await fetch(
        `/api/posts/${angleId}/slide/${slide.n}/generate-image`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      toast.success("Generation started — variants will appear in ~60s");
      // Poll for variants to land.
      const start = Date.now();
      const poll = setInterval(async () => {
        await refresh();
        if (Date.now() - start > 180_000) {
          clearInterval(poll);
          setGenerating(false);
        }
      }, 5_000);
      // Stop polling early if we see 4 fresh variants.
      const interval = setInterval(async () => {
        const r = await fetch(`/api/posts/${angleId}/assets`);
        const d = await r.json();
        const recent = ((d.assets ?? []) as Asset[]).filter(
          (a) => a.slide_n === slide.n && new Date(a.generated_at).getTime() > start - 1000,
        );
        if (recent.length >= 4) {
          clearInterval(interval);
          clearInterval(poll);
          await refresh();
          setGenerating(false);
        }
      }, 4_000);
      // Safety stop.
      setTimeout(() => {
        clearInterval(interval);
        clearInterval(poll);
        setGenerating(false);
      }, 200_000);
    } catch (e) {
      toast.error(`Generate failed: ${(e as Error).message}`);
      setGenerating(false);
    }
  }

  async function pick(asset: Asset) {
    if (!slide) return;
    try {
      const res = await fetch(
        `/api/posts/${angleId}/slide/${slide.n}/pick-variant`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId: asset.id }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      toast.success(`Slide ${slide.n} variant picked`);
      onPicked(data.angle);
      // Optimistically update local state.
      setAssets((prev) =>
        prev.map((a) => ({ ...a, picked_at: a.id === asset.id ? new Date().toISOString() : null })),
      );
    } catch (e) {
      toast.error(`Pick failed: ${(e as Error).message}`);
    }
  }

  if (!slide) return null;
  const hasPrompt = !!slide.image_gen_prompt?.trim();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Slide {slide.n} · image variants
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {hasPrompt
              ? "Generates 4 variants from the slide's image_gen_prompt + your account's Brand Prompt Prefix. Pick one."
              : "This slide has no image_gen_prompt. Edit the slide and add one to enable image generation."}
          </p>
          {hasPrompt ? (
            <pre className="mt-2 text-[10px] font-mono bg-muted/30 border border-border rounded p-2 whitespace-pre-wrap text-muted-foreground max-h-20 overflow-y-auto">
              {slide.image_gen_prompt}
            </pre>
          ) : null}
        </DialogHeader>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              {assets.length === 0 ? "No variants yet" : `${assets.length} variant${assets.length === 1 ? "" : "s"}`}
            </div>
            <Button
              size="sm"
              onClick={generate}
              disabled={!hasPrompt || generating}
              className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
            >
              {generating ? "Generating…" : assets.length > 0 ? "↻ Regenerate 4 variants" : "Generate 4 variants"}
            </Button>
          </div>

          {loading && assets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Loading variants…
            </div>
          ) : assets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No variants yet. Click <strong>Generate 4 variants</strong> to start.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {assets.map((a) => {
                const url = publicUrl(a.storage_path);
                const picked = !!a.picked_at;
                return (
                  <button
                    type="button"
                    key={a.id}
                    onClick={() => pick(a)}
                    className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-transform hover:-translate-y-0.5 ${
                      picked
                        ? "border-lynx-green ring-2 ring-lynx-green"
                        : "border-border hover:border-foreground/30"
                    }`}
                  >
                    {url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={`Variant ${a.variant_n + 1}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-muted" />
                    )}
                    <div className="absolute top-2 left-2 flex gap-1.5">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                          picked
                            ? "bg-lynx-green text-lynx-charcoal"
                            : "bg-foreground/80 text-background"
                        }`}
                      >
                        {picked ? "✓ PICKED" : `V${a.variant_n + 1}`}
                      </span>
                      {typeof a.brand_score === "number" ? (
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                            a.brand_score >= 60
                              ? "bg-green-100 text-green-800"
                              : a.brand_score >= 40
                                ? "bg-amber-100 text-amber-800"
                                : "bg-rose-100 text-rose-800"
                          }`}
                          title={`Closest palette: ${a.brand_score_detail?.closest_palette_key ?? "?"}`}
                        >
                          {a.brand_score} brand
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
