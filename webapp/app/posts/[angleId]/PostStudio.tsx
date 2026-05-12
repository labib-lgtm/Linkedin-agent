"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PostStudioCopy } from "./PostStudioCopy";
import { MarkDraftedButton } from "./MarkDraftedButton";
import { MarkVisualReadyButton } from "./MarkVisualReadyButton";
import { MarkReviewedButton } from "./MarkReviewedButton";
import { RenderAndPublishButton } from "./RenderAndPublishButton";
import { SlideStudio } from "@/components/posts/SlideStudio";
import { ImageStudio } from "@/components/posts/ImageStudio";
import { CoherencePanel, type CoherenceScores } from "@/components/posts/CoherencePanel";
import { LinkedInPreview } from "@/components/posts/LinkedInPreview";
import type { Palette, Slide } from "@/components/posts/SlideCard";

type HookVariant = {
  text: string;
  voice_match_score: number | null;
  model_self_estimate: number | null;
};

type BodyParagraph = {
  role: "hook" | "setup" | "pivot" | "list" | "payoff" | "cta";
  text: string;
};

export type StudioAngle = {
  angle_id: string;
  status: string;
  pillar: string | null;
  format: string | null;
  hook_seed: string | null;
  cta_keyword: string | null;
  gap_filled: string | null;
  notes: string | null;
  draft_body: string | null;
  hook_chosen: string | null;
  hook_variants: HookVariant[] | null;
  selected_hook_index: number | null;
  body_paragraphs: BodyParagraph[] | null;
  cta_archetype: string | null;
  cta_text: string | null;
  pin_comment: string | null;
  copy_generated_at: string | null;
  carousel_template: string | null;
  carousel_slides: Slide[] | null;
  slides_generated_at: string | null;
  slide_image_paths: Record<string, string> | null;
  coherence_scores: CoherenceScores | null;
  coherence_checked_at: string | null;
  carousel_pdf_path: string | null;
  carousel_rendered_at: string | null;
  publish_run_id: string | null;
  published_media_urn: string | null;
  dm_response_template: string | null;
  dm_response_includes_link: boolean | null;
  dm_template_generated_at: string | null;
  lead_magnet_id: string | null;
  lead_magnet_url: string | null;
  lead_magnet_path: string | null;
};

// The studio's frame — split-pane Copy / Visual + two FAB overlays
// (Coherence panel + LinkedIn preview) introduced in Phase D.
export function PostStudio({
  initialAngle,
  brandPalette,
  authorName,
  authorPicture,
}: {
  initialAngle: StudioAngle;
  brandPalette: Palette;
  authorName: string;
  authorPicture: string | null;
}) {
  const router = useRouter();
  const [angle, setAngle] = useState<StudioAngle>(initialAngle);
  const [generating, setGenerating] = useState(false);
  const [, startTransition] = useTransition();

  const hasCopy = useMemo(() => {
    return Array.isArray(angle.body_paragraphs) && angle.body_paragraphs.length > 0;
  }, [angle.body_paragraphs]);

  // Mark Visual Ready gating:
  //   text/poll  → copy present
  //   image      → copy + picked image variant in slide_image_paths['1']
  //   carousel   → copy + slides + every illustrated slide has a pick
  //   video      → copy (video script lands later)
  // Plus the coherence publish-check must pass (or not have been run).
  const visualReady = useMemo(() => {
    if (!hasCopy) return false;
    if (angle.format === "carousel") {
      const slides = angle.carousel_slides ?? [];
      const paths = angle.slide_image_paths ?? {};
      for (const s of slides) {
        if (s.image_gen_prompt && !paths[String(s.n)]) return false;
      }
      if (slides.length === 0) return false;
    }
    if (angle.format === "image") {
      const path = angle.slide_image_paths?.["1"];
      if (!path) return false;
    }
    if (angle.coherence_scores && !angle.coherence_scores.publishable.ok) return false;
    return true;
  }, [
    hasCopy,
    angle.format,
    angle.carousel_slides,
    angle.slide_image_paths,
    angle.coherence_scores,
  ]);

  async function generateCopy(opts: { hookOnly?: boolean; ctaOnly?: boolean; ctaArchetype?: string } = {}) {
    setGenerating(true);
    try {
      const res = await fetch(`/api/posts/${angle.angle_id}/generate-copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
      }
      setAngle(data.angle);
      const note = opts.ctaOnly
        ? "CTA rewritten under the new archetype"
        : opts.hookOnly
          ? "Hook variants regenerated"
          : data.voice_samples_used > 0
            ? `Generated · ${data.voice_samples_used} voice samples grounding`
            : "Generated · using business.voice fallback (no posted history yet)";
      toast.success(note);
      startTransition(() => router.refresh());
    } catch (e) {
      toast.error(`Generate failed: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  }

  async function patchAngle(patch: Partial<StudioAngle>) {
    const res = await fetch(`/api/posts/${angle.angle_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.message ?? data?.error ?? `HTTP ${res.status}`);
    }
    setAngle(data.angle);
    return data.angle as StudioAngle;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* LEFT pane: Copy editor */}
      <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
        <header className="flex items-center justify-between gap-3 px-5 py-3 border-b border-border bg-muted/30">
          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-foreground/70">
            Copy
          </div>
          <div className="flex items-center gap-2">
            {hasCopy && angle.status !== "Visual Ready" ? (
              <MarkDraftedButton
                angleId={angle.angle_id}
                disabled={!hasCopy}
                onMarked={(updated) => setAngle(updated)}
              />
            ) : null}
            {visualReady && angle.status !== "Visual Ready" ? (
              <MarkVisualReadyButton
                angleId={angle.angle_id}
                onMarked={(updated) => setAngle(updated)}
              />
            ) : null}
            {angle.status === "Visual Ready" || angle.status === "Drafted" ? (
              <RenderAndPublishButton
                angle={angle}
                onUpdated={(updated) => setAngle(updated)}
              />
            ) : null}
            {angle.status === "Posted" ? (
              <MarkReviewedButton
                angleId={angle.angle_id}
                onMarked={(updated) => setAngle(updated)}
              />
            ) : null}
            <Button
              size="sm"
              onClick={() => generateCopy()}
              disabled={generating}
              className="bg-lynx-green text-lynx-charcoal hover:bg-lynx-green/90"
            >
              {generating ? "Generating…" : hasCopy ? "Regenerate copy" : "Generate copy"}
            </Button>
          </div>
        </header>
        <div className="px-5 py-4 space-y-5 overflow-y-auto">
          <PostStudioCopy
            angle={angle}
            generating={generating}
            onGenerate={generateCopy}
            onPatch={patchAngle}
            onAngleUpdated={(updated) => setAngle(updated)}
          />
        </div>
      </div>

      {/* RIGHT pane: format-specific studio.
            carousel → SlideStudio (template + slide grid + variants)
            image    → ImageStudio (single prompt + 4 variants)
            other    → SlideStudio's "no slides" placeholder */}
      {angle.format === "image" ? (
        <ImageStudio
          angleId={angle.angle_id}
          carouselSlides={angle.carousel_slides}
          slideImagePaths={angle.slide_image_paths}
          hasBody={hasCopy}
          onUpdate={(next) => setAngle((cur) => ({ ...cur, ...next }))}
        />
      ) : (
        <SlideStudio
          angleId={angle.angle_id}
          format={angle.format}
          carouselTemplate={angle.carousel_template}
          carouselSlides={angle.carousel_slides}
          slideImagePaths={angle.slide_image_paths}
          brandPalette={brandPalette}
          onUpdate={(next) => setAngle((cur) => ({ ...cur, ...next }))}
        />
      )}

      {/* Phase D FABs */}
      <CoherencePanel
        angleId={angle.angle_id}
        scores={angle.coherence_scores}
        checkedAt={angle.coherence_checked_at}
        onScored={(updated) => setAngle((cur) => ({ ...cur, ...updated }))}
      />
      <LinkedInPreview
        authorName={authorName}
        authorPicture={authorPicture}
        bodyParagraphs={angle.body_paragraphs}
        format={angle.format}
        slideImagePaths={angle.slide_image_paths}
        totalSlides={angle.carousel_slides?.length ?? 0}
      />
    </div>
  );
}
