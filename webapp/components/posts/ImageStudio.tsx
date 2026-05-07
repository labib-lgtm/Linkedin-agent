"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { SlideVariantPicker } from "./SlideVariantPicker";
import type { Slide } from "./SlideCard";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "post-assets";

function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

// Single-image gen for format = 'image'.
//
// Reuses the same Trigger.dev task (generate-slide-images) the carousel
// studio uses — image-format angles store a 1-element carousel_slides
// array with n=1 + image_gen_prompt. Picks land in slide_image_paths['1']
// which the publish route already reads for image format.
export function ImageStudio({
  angleId,
  carouselSlides,
  slideImagePaths,
  hasBody,
  onUpdate,
}: {
  angleId: string;
  carouselSlides: Slide[] | null;
  slideImagePaths: Record<string, string> | null;
  hasBody: boolean;
  onUpdate: (next: { carousel_slides?: Slide[] | null; slide_image_paths?: Record<string, string> | null } & Record<string, unknown>) => void;
}) {
  const slide = (carouselSlides ?? [])[0] ?? null;
  const [prompt, setPrompt] = useState(slide?.image_gen_prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [picker, setPicker] = useState(false);

  useEffect(() => {
    setPrompt((carouselSlides ?? [])[0]?.image_gen_prompt ?? "");
  }, [carouselSlides]);

  const pickedPath = slideImagePaths?.["1"] ?? null;
  const pickedUrl = publicAssetUrl(pickedPath);

  async function savePrompt() {
    if (!prompt.trim()) return;
    if (slide && prompt === slide.image_gen_prompt) return;
    setSaving(true);
    try {
      // Upsert a single virtual slide so the existing image-gen task
      // (which reads angle.carousel_slides[n]) works without changes.
      const updatedSlide: Slide = {
        n: 1,
        role: "image",
        layout: "image",
        headline: "",
        supporting: null,
        stat: null,
        visual_element: "illustration",
        color_emphasis: "primary",
        image_gen_prompt: prompt.trim(),
      };
      const res = await fetch(`/api/posts/${angleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carousel_slides: [updatedSlide] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onUpdate(data.angle);
      toast.success("Image prompt saved");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  // Calls Haiku with imagePromptDrafterSystemPrompt to translate the
  // FULL post body + hook into a concrete visual brief. Solves the
  // "POST COPY rendered as text on a card" failure where a meta-prompt
  // produces a meta-image. Brief is only the subject/scene — brand
  // style + palette get prepended by the trigger task.
  async function draftFromBody() {
    setDrafting(true);
    try {
      const res = await fetch(`/api/posts/${angleId}/draft-image-prompt`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      setPrompt(data.prompt as string);
      toast.success("Drafted from post body");
    } catch (e) {
      toast.error(`Draft failed: ${(e as Error).message}`);
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30">
        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground/70">
          Visual · single image
        </div>
        <div className="flex items-center gap-2">
          {slide?.image_gen_prompt ? (
            <Button
              size="sm"
              onClick={() => setPicker(true)}
              className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
            >
              {pickedPath ? "✓ View / change variant" : "Generate 4 variants"}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="px-5 py-4 space-y-5 overflow-y-auto">
        {/* Picked image preview */}
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
            Picked image
          </h3>
          <div className="aspect-square rounded-lg border border-border overflow-hidden bg-muted/30">
            {pickedUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pickedUrl}
                alt="Picked image"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground p-6 text-center">
                {slide?.image_gen_prompt
                  ? "No variant picked yet. Click Generate 4 variants above."
                  : "Set an image prompt below, save, then generate variants."}
              </div>
            )}
          </div>
        </section>

        {/* Prompt editor */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              Image gen prompt
            </Label>
            {hasBody ? (
              <button
                type="button"
                onClick={draftFromBody}
                disabled={drafting}
                className="text-[11px] text-foreground/70 hover:text-foreground disabled:opacity-60"
              >
                {drafting ? "Drafting…" : "↺ Draft from post body"}
              </button>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">
                Generate copy first to enable auto-draft
              </span>
            )}
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={
              "Describe what the picture LITERALLY SHOWS — one subject, one scene. " +
              "Example: 'A bucket with five holes of varying sizes, water streaming out at different rates.' " +
              "Keep under 300 chars. Brand style + palette is added automatically."
            }
            className="text-sm"
          />
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[10px] tabular-nums ${
                prompt.length > 300
                  ? "text-rose-700 font-semibold"
                  : prompt.length > 200
                    ? "text-amber-700"
                    : "text-muted-foreground"
              }`}
            >
              {prompt.length} / 300 chars
              {prompt.length > 300 ? " · too long, image model will pick random visuals" : ""}
            </span>
            <div className="flex gap-1.5">
              {prompt ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPrompt("")}
                  className="text-muted-foreground"
                  title="Clear and start over"
                >
                  Clear
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={savePrompt}
                disabled={saving || !prompt.trim()}
              >
                {saving ? "Saving…" : "Save prompt"}
              </Button>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground leading-snug">
            <strong className="text-foreground">Tip:</strong> use <em>↺ Draft from post body</em>{" "}
            for a clean single-visual brief. Pasting the whole post body here gets generic
            output — the image model can&apos;t pick a single subject from a long passage.
          </p>
        </section>
      </div>

      {slide ? (
        <SlideVariantPicker
          open={picker}
          slide={slide}
          angleId={angleId}
          onClose={() => setPicker(false)}
          onPicked={(updated) => onUpdate(updated)}
        />
      ) : null}
    </div>
  );
}
