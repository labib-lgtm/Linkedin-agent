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
// Default mode: drafterless — the trigger task sends the post body
// directly to the image model with brand framing, no Sonnet 4 step.
// Override mode (collapsed disclosure): operator types or drafts the
// image prompt manually for surgical control.
//
// Reuses generate-slide-images Trigger.dev task. Image-format angles
// store a 1-element carousel_slides array with n=1 so the task has a
// row to attach post_assets to. Picks land in slide_image_paths['1']
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
  onUpdate: (
    next: { carousel_slides?: Slide[] | null; slide_image_paths?: Record<string, string> | null } & Record<
      string,
      unknown
    >,
  ) => void;
}) {
  const slide = (carouselSlides ?? [])[0] ?? null;
  const [overrideOpen, setOverrideOpen] = useState(!!slide?.image_gen_prompt);
  const [prompt, setPrompt] = useState(slide?.image_gen_prompt ?? "");
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [picker, setPicker] = useState(false);
  const [ensuringStub, setEnsuringStub] = useState(false);

  useEffect(() => {
    setPrompt((carouselSlides ?? [])[0]?.image_gen_prompt ?? "");
  }, [carouselSlides]);

  const pickedPath = slideImagePaths?.["1"] ?? null;
  const pickedUrl = publicAssetUrl(pickedPath);

  // Ensure carousel_slides[0] exists. Image gen task requires a slide
  // row to attach variants to. Drafterless path: stub slide with no
  // image_gen_prompt; trigger reads angle.body_paragraphs instead.
  async function ensureStubSlide(): Promise<boolean> {
    if (slide) return true;
    setEnsuringStub(true);
    try {
      const stub: Slide = {
        n: 1,
        role: "image",
        layout: "image",
        headline: "",
        supporting: null,
        stat: null,
        visual_element: "illustration",
        color_emphasis: "primary",
        image_gen_prompt: null,
      };
      const res = await fetch(`/api/posts/${angleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carousel_slides: [stub] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onUpdate(data.angle);
      return true;
    } catch (e) {
      toast.error(`Setup failed: ${(e as Error).message}`);
      return false;
    } finally {
      setEnsuringStub(false);
    }
  }

  async function openDrafterlessPicker() {
    if (!hasBody) {
      toast.error("Generate copy first — drafterless image gen reads your post body.");
      return;
    }
    const ok = await ensureStubSlide();
    if (ok) setPicker(true);
  }

  async function savePrompt() {
    if (!prompt.trim()) return;
    if (slide && prompt === slide.image_gen_prompt) return;
    setSaving(true);
    try {
      const updatedSlide: Slide = {
        ...(slide ?? {
          n: 1,
          role: "image",
          layout: "image",
          headline: "",
          supporting: null,
          stat: null,
          visual_element: "illustration",
          color_emphasis: "primary",
        }),
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
      toast.success("Override prompt saved");
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function clearOverride() {
    setPrompt("");
    if (!slide?.image_gen_prompt) return;
    try {
      const updatedSlide: Slide = { ...slide, image_gen_prompt: null };
      const res = await fetch(`/api/posts/${angleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carousel_slides: [updatedSlide] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onUpdate(data.angle);
      toast.success("Override cleared — back to drafterless");
    } catch (e) {
      toast.error(`Clear failed: ${(e as Error).message}`);
    }
  }

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

  const hasOverride = !!slide?.image_gen_prompt?.trim();

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30">
        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground/70">
          Visual · single image
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${
              hasOverride ? "bg-amber-100 text-amber-800" : "bg-lynx-green/20 text-lynx-charcoal"
            }`}
          >
            {hasOverride ? "override" : "drafterless"}
          </span>
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
                No variant picked yet. Click <strong>Generate 4 variants</strong> below.
              </div>
            )}
          </div>
        </section>

        {/* Primary CTA — drafterless generation */}
        <section className="space-y-2">
          <div className="rounded-lg border border-border bg-background p-4 space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Generate from post body
              </h3>
              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                Sends your post body directly to the image model ({hasOverride ? "currently overridden" : "active"})
                wrapped with your brand style + palette + composition rules. No drafter step. One LLM call.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                if (hasOverride) {
                  // Override path — open picker, trigger task uses slide.image_gen_prompt
                  setPicker(true);
                } else {
                  openDrafterlessPicker();
                }
              }}
              disabled={ensuringStub || (!hasOverride && !hasBody)}
              className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90 w-full"
            >
              {ensuringStub
                ? "Setting up…"
                : pickedPath
                  ? "✓ View / change variant"
                  : hasOverride
                    ? "Generate 4 variants (override)"
                    : "Generate 4 variants from post body"}
            </Button>
            {!hasBody && !hasOverride ? (
              <p className="text-[10px] text-rose-700 italic">
                Generate copy first — drafterless gen reads angles.body_paragraphs.
              </p>
            ) : null}
          </div>
        </section>

        {/* Override mode — collapsed disclosure */}
        <section>
          <button
            type="button"
            onClick={() => setOverrideOpen((v) => !v)}
            className="w-full text-left flex items-center justify-between gap-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground py-1"
          >
            <span>
              {overrideOpen ? "▾" : "▸"} Override prompt manually
              {hasOverride ? " · active" : ""}
            </span>
            <span className="text-[10px] font-normal italic">
              {hasOverride ? "Drafterless disabled while override is set" : "For surgical control"}
            </span>
          </button>

          {overrideOpen ? (
            <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
                  Image gen prompt (override)
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
                ) : null}
              </div>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={8}
                placeholder={
                  "Cinematic scene brief — describe the full picture in 80–200 words. " +
                  "Allowed: real product UI, dual-state compositions, hands in frame, readable text in image. " +
                  "Saving here puts the studio in OVERRIDE mode (drafterless disabled until cleared)."
                }
                className="text-sm font-mono leading-relaxed"
              />
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] tabular-nums ${
                    prompt.length > 1500
                      ? "text-rose-700 font-semibold"
                      : prompt.length > 1200
                        ? "text-amber-700"
                        : "text-muted-foreground"
                  }`}
                >
                  {prompt.length} / 1500 chars
                </span>
                <div className="flex gap-1.5">
                  {hasOverride ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearOverride}
                      className="text-muted-foreground"
                      title="Clear override and return to drafterless"
                    >
                      Clear override
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={savePrompt}
                    disabled={saving || !prompt.trim()}
                  >
                    {saving ? "Saving…" : "Save override"}
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                Use this when you have a specific scene in mind that the drafterless path
                doesn&apos;t capture. The override prompt goes verbatim to the image model.
              </p>
            </div>
          ) : null}
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
