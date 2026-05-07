"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SlideCard, type Palette, type Slide } from "./SlideCard";
import { SlideEditDrawer } from "./SlideEditDrawer";

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
  brandPalette,
  onUpdate,
}: {
  angleId: string;
  format: string | null;
  carouselTemplate: string | null;
  carouselSlides: Slide[] | null;
  brandPalette: Palette;
  onUpdate: (next: { carousel_template?: string | null; carousel_slides?: Slide[] | null } & Record<string, unknown>) => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [pickedSlide, setPickedSlide] = useState<Slide | null>(null);

  const isCarousel = format === "carousel";
  const slides = useMemo(() => carouselSlides ?? [], [carouselSlides]);
  const template = (carouselTemplate ?? "list") as Template;

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
              {slides.map((s) => (
                <SlideCard
                  key={s.n}
                  slide={s}
                  palette={brandPalette}
                  total={slides.length}
                  onClick={() => setPickedSlide(s)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Brand references row — Phase B stub. Phase C fills this from
            post_assets where picked_at is not null. */}
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.16em] font-bold text-muted-foreground mb-2">
            Brand references · last 5 visuals
          </h3>
          <div className="grid grid-cols-5 gap-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="aspect-square rounded border border-dashed border-border bg-muted/30"
              />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            Populated by Phase C once you pick illustration variants per slide.
          </p>
        </section>
      </div>

      <SlideEditDrawer
        open={pickedSlide !== null}
        slide={pickedSlide}
        angleId={angleId}
        onClose={() => setPickedSlide(null)}
        onSaved={(updated) => {
          onUpdate(updated);
          setPickedSlide(null);
        }}
      />
    </div>
  );
}
