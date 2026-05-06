"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PostStudioCopy } from "./PostStudioCopy";
import { MarkDraftedButton } from "./MarkDraftedButton";

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
};

// The studio's frame — split-pane Copy / Visual. Phase A only renders
// the Copy pane; the right pane is a placeholder noting Phase B + C.
export function PostStudio({ initialAngle }: { initialAngle: StudioAngle }) {
  const router = useRouter();
  const [angle, setAngle] = useState<StudioAngle>(initialAngle);
  const [generating, setGenerating] = useState(false);
  const [, startTransition] = useTransition();

  const hasCopy = useMemo(() => {
    return Array.isArray(angle.body_paragraphs) && angle.body_paragraphs.length > 0;
  }, [angle.body_paragraphs]);

  async function generateCopy(opts: { hookOnly?: boolean; ctaArchetype?: string } = {}) {
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
      const note =
        data.voice_samples_used > 0
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
            {hasCopy ? (
              <MarkDraftedButton
                angleId={angle.angle_id}
                disabled={!hasCopy}
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
          />
        </div>
      </div>

      {/* RIGHT pane: Visual placeholder (Phase B+C) */}
      <div className="rounded-xl border border-dashed border-border bg-muted/10 flex flex-col items-center justify-center p-10 text-center min-h-[400px]">
        <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-muted-foreground mb-2">
          Visual studio
        </div>
        <h3 className="text-lg font-semibold mb-2">Coming in Phase B + C</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Carousel slide structure (Phase B) + per-slide image generation with brand
          consistency check (Phase C) land here. Phase A ships the copy half so the
          Drafting → Drafted flow is end-to-end today.
        </p>
      </div>
    </div>
  );
}
