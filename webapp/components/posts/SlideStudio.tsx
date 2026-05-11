"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SlideCard, type Palette, type Slide } from "./SlideCard";
import { SlideEditDrawer } from "./SlideEditDrawer";
import { SlideVariantPicker } from "./SlideVariantPicker";
import { ImproveButton } from "./ImproveButton";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const STORAGE_BUCKET = "post-assets";

function publicAssetUrl(path: string | null | undefined): string | null {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

type Template = "story" | "list" | "compare" | "framework";

const TEMPLATE_META: Array<{
  id: Template;
  label: string;
  desc: string;
  icon: React.ReactNode;
}> = [
  {
    id: "story",
    label: "Story",
    desc: "Narrative arc",
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="6" width="24" height="20" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <line x1="4" y1="12" x2="28" y2="12" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: "list",
    label: "List",
    desc: "Numbered points",
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <rect x="6" y="6" width="20" height="3" fill="currentColor" />
        <rect x="6" y="13" width="14" height="2" fill="currentColor" opacity="0.5" />
        <rect x="6" y="17" width="16" height="2" fill="currentColor" opacity="0.5" />
        <rect x="6" y="21" width="12" height="2" fill="currentColor" opacity="0.5" />
      </svg>
    ),
  },
  {
    id: "compare",
    label: "Compare",
    desc: "Before / After",
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="6" width="11" height="20" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
        <rect x="17" y="6" width="11" height="20" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    ),
  },
  {
    id: "framework",
    label: "Framework",
    desc: "Diagram-led",
    icon: (
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
        <rect x="4" y="20" width="4" height="6" fill="currentColor" />
        <rect x="10" y="14" width="4" height="12" fill="currentColor" />
        <rect x="16" y="10" width="4" height="16" fill="currentColor" />
        <rect x="22" y="6" width="4" height="20" fill="currentColor" />
      </svg>
    ),
  },
];

export function SlideStudio({
  angleId,
  format,
  carouselTemplate,
  carouselSlides,
  slideImagePaths,
  brandPalette,
  onUpdate,
}: {
  angleId: string;
  format: string | null;
  carouselTemplate: string | null;
  carouselSlides: Slide[] | null;
  slideImagePaths: Record<string, string> | null;
  brandPalette: Palette;
  onUpdate: (next: { carousel_template?: string | null; carousel_slides?: Slide[] | null; slide_image_paths?: Record<string, string> | null } & Record<string, unknown>) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [editingSlide, setEditingSlide] = useState<Slide | null>(null);
  const [variantSlide, setVariantSlide] = useState<Slide | null>(null);
  const [recentPicked, setRecentPicked] = useState<string[]>([]);

  const isCarousel = format === "carousel";
  const slides = useMemo(() => carouselSlides ?? [], [carouselSlides]);
  const template = (carouselTemplate ?? "list") as Template;
  const paths = slideImagePaths ?? {};

  // Brand references row — last 5 picked variants for the active angle.
  // Pulled from /assets so it auto-refreshes when a new pick lands.
  useEffect(() => {
    if (!isCarousel) return;
    let cancelled = false;
    fetch(`/api/posts/${angleId}/assets`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const all = (data.assets ?? []) as Array<{ storage_path: string; picked_at: string | null }>;
        const picked = all
          .filter((a) => a.picked_at)
          .sort((a, b) => (a.picked_at! < b.picked_at! ? 1 : -1))
          .slice(0, 5)
          .map((a) => a.storage_path);
        setRecentPicked(picked);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [angleId, isCarousel, slideImagePaths]);

  async function generateSlides(t: Template) {
    setGenerating(true);
    try {
      const res = await fetch(`/api/posts/${angleId}/generate-slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: t }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      toast.success(`${data.slide_count} slides generated`);
      onUpdate(data.angle);
    } catch (e) {
      toast.error(`Generate failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  if (!isCarousel) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/10 flex flex-col items-center justify-center p-10 text-center min-h-[400px]">
        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2">
          Visual studio
        </div>
        <h3 className="text-base font-semibold mb-1">
          Slide editor is for carousel posts
        </h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          This angle&apos;s format is{" "}
          <code className="px-1.5 py-0.5 rounded bg-muted text-xs">{format ?? "text"}</code>.
          Switch the angle to <code className="px-1.5 py-0.5 rounded bg-muted text-xs">carousel</code>{" "}
          format if you want a slide deck.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
      <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30">
        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground/70">
          Visual
        </div>
        {slides.length > 0 ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateSlides(template)}
            disabled={generating}
          >
            {generating ? "Generating…" : "↻ Regenerate all"}
          </Button>
        ) : null}
      </header>

      <div className="px-5 py-4 space-y-5 overflow-y-auto">
        {/* Template picker */}
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
            Template · choose 1
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {TEMPLATE_META.map((t) => {
              const active = t.id === template && slides.length > 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => generateSlides(t.id)}
                  disabled={generating}
                  className={`p-2.5 rounded-lg border text-center transition-colors disabled:opacity-50 ${
                    active
                      ? "border-lynx-green bg-lynx-green/10"
                      : "border-border bg-background hover:border-foreground/30"
                  }`}
                >
                  <div
                    className={`flex items-center justify-center h-9 mb-1 ${
                      active ? "text-lynx-charcoal" : "text-muted-foreground"
                    }`}
                  >
                    {t.icon}
                  </div>
                  <div className="text-[11px] font-semibold text-foreground">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground">{t.desc}</div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Slides grid */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground">
              Slides {slides.length > 0 ? `· ${slides.length} · click to edit` : ""}
            </h3>
          </div>
          {slides.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-muted/10 p-8 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No slide spec yet. Pick a template above to generate one from the body draft.
              </p>
              <Button
                size="sm"
                onClick={() => generateSlides("list")}
                disabled={generating}
                className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
              >
                {generating ? "Generating…" : "Generate list slides"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {slides.map((s) => {
                const pickedPath = paths[String(s.n)] ?? null;
                const hasImagePrompt = !!s.image_gen_prompt?.trim();
                return (
                  <div key={s.n} className="space-y-1.5">
                    <SlideCard
                      slide={s}
                      palette={brandPalette}
                      total={slides.length}
                      pickedImagePath={pickedPath}
                      onClick={() => setEditingSlide(s)}
                    />
                    {/* Per-slide footer: variants / brief button (left),
                        sparkle improve (middle), text-only escape (right).
                        Comment-driven revamp works even when
                        image_gen_prompt is empty — the improve endpoint
                        seeds it from slide copy. Text-only is only
                        offered when there's something to clear. */}
                    <div className="flex items-stretch gap-1">
                      {hasImagePrompt ? (
                        <button
                          type="button"
                          onClick={() => setVariantSlide(s)}
                          className={`flex-1 text-[10px] font-semibold py-1 rounded border transition-colors ${
                            pickedPath
                              ? "border-lynx-green bg-lynx-green/10 text-lynx-charcoal hover:bg-lynx-green/20"
                              : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30"
                          }`}
                        >
                          {pickedPath ? "✓ Image picked · view variants" : "Generate 4 image variants"}
                        </button>
                      ) : (
                        <span className="flex-1 text-[10px] py-1 text-center text-muted-foreground/60 italic">
                          no image brief yet
                        </span>
                      )}
                      <span className="flex items-center justify-center px-1 rounded border border-border bg-background">
                        <ImproveButton
                          angleId={angleId}
                          target="slide-image"
                          index={s.n}
                          align={s.n % 2 === 0 ? "right" : "left"}
                          label={
                            hasImagePrompt
                              ? "Revamp this image"
                              : "Draft image brief from a comment"
                          }
                          onApplied={(updatedAngle) => onUpdate(updatedAngle)}
                        />
                      </span>
                      {hasImagePrompt || pickedPath ? (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const res = await fetch(
                                `/api/posts/${angleId}/slide/${s.n}/pick-variant`,
                                { method: "DELETE" },
                              );
                              const data = await res.json();
                              if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
                              onUpdate(data.angle);
                              toast.success(`Slide ${s.n} is now text-only`);
                            } catch (e) {
                              toast.error(`Could not clear: ${(e as Error).message}`);
                            }
                          }}
                          title="Keep this slide text-only — clear illustration and image brief."
                          className="flex items-center justify-center px-1.5 rounded border border-border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="w-3 h-3"
                            aria-hidden="true"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Brand references row — last 5 picked illustrations for the
            active angle. Useful sanity check that picked variants share
            a visual language; Phase C's vision check lands per-variant
            but the human eye is still the final judge. */}
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
            Brand references · last 5 picked
          </h3>
          <div className="grid grid-cols-5 gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => {
              const url = publicAssetUrl(recentPicked[i]);
              return (
                <div
                  key={i}
                  className="aspect-square rounded border border-border bg-muted/30 overflow-hidden"
                >
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={`Picked ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            {recentPicked.length === 0
              ? "Pick illustration variants per slide to populate this row."
              : `${recentPicked.length} picked illustration${recentPicked.length === 1 ? "" : "s"} for this angle.`}
          </p>
        </section>
      </div>

      <SlideEditDrawer
        open={editingSlide !== null}
        slide={editingSlide}
        angleId={angleId}
        onClose={() => setEditingSlide(null)}
        onSaved={(updated) => {
          onUpdate(updated);
          setEditingSlide(null);
        }}
      />
      <SlideVariantPicker
        open={variantSlide !== null}
        slide={variantSlide}
        angleId={angleId}
        onClose={() => setVariantSlide(null)}
        onPicked={(updated) => onUpdate(updated)}
      />
    </div>
  );
}
