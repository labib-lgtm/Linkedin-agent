import { NextResponse, type NextRequest } from "next/server";
import { tasks } from "@trigger.dev/sdk/v3";
import { createServiceClient } from "@/lib/supabase/server";
import { generateText, generateJson, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { refineSectionPrompt, refineFullBodyPrompt } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// POST /api/posts/[angleId]/improve
//
// Body:
//   { target: "hook" | "body" | "slide-copy" | "slide-image",
//     index: number,                  // 0-based for hook/body, 1-based for slide
//     instruction: string }           // operator's freeform correction
//
// Behavior per target:
//   hook         — rewrite hook_variants[index].text, keep score fields
//   body         — rewrite body_paragraphs[index].text, rejoin draft_body
//   slide-copy   — rewrite carousel_slides[index-1].headline, invalidate PDF
//   slide-image  — rewrite carousel_slides[index-1].image_gen_prompt
//                  then fire the generate-slide-images Trigger.dev task

type Target = "hook" | "body" | "body-all" | "slide-copy" | "slide-image";
const TARGETS: Target[] = ["hook", "body", "body-all", "slide-copy", "slide-image"];

type HookVariant = {
  text: string;
  voice_match_score?: number | null;
  model_self_estimate?: number | null;
};

type BodyParagraph = { role: string; text: string };

type Slide = {
  n: number;
  role: string;
  layout: string;
  headline: string;
  supporting: string | null;
  stat: string | null;
  visual_element: string;
  color_emphasis: string;
  image_gen_prompt: string | null;
};

function joinBody(paragraphs: BodyParagraph[]): string {
  return paragraphs.map((p) => p.text).join("\n\n").trim();
}

function userPrompt(section: string, current: string, instruction: string): string {
  return `SECTION: ${section}
CURRENT:
${current}

INSTRUCTION:
${instruction}

Return only the rewritten text.`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;

  let payload: { target?: string; index?: number; instruction?: string };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const target = payload.target as Target | undefined;
  const index = typeof payload.index === "number" ? payload.index : NaN;
  const instruction = (payload.instruction ?? "").trim();

  if (!target || !TARGETS.includes(target)) {
    return NextResponse.json(
      { error: "invalid_target", message: `target must be one of: ${TARGETS.join(", ")}` },
      { status: 400 },
    );
  }
  // body-all targets the entire body, so no index is required.
  if (target !== "body-all" && (!Number.isInteger(index) || index < 0)) {
    return NextResponse.json({ error: "invalid_index" }, { status: 400 });
  }
  if (!instruction) {
    return NextResponse.json({ error: "instruction_required" }, { status: 400 });
  }
  if (instruction.length > 500) {
    return NextResponse.json(
      { error: "instruction_too_long", message: "Keep instructions under 500 chars." },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { data: angle, error: aErr } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  // ────────────────────────────────────────────────────────────────────
  // body-all — single-shot whole-body rewrite. Uses generateJson so the
  // paragraph / role mapping survives. Per-paragraph improves break
  // coherence between paragraphs, hence this section-level surface.
  // ────────────────────────────────────────────────────────────────────
  if (target === "body-all") {
    const paras = (angle.body_paragraphs as BodyParagraph[] | null) ?? [];
    if (paras.length === 0) {
      return NextResponse.json(
        { error: "no_body_paragraphs", message: "Generate body copy first." },
        { status: 400 },
      );
    }

    const businessProfile = await getBusinessProfile();
    let rewrittenBody: { body_paragraphs?: BodyParagraph[] };
    try {
      rewrittenBody = await generateJson<{ body_paragraphs?: BodyParagraph[] }>({
        system: refineFullBodyPrompt(businessProfile),
        user: `CURRENT:\n${JSON.stringify(paras, null, 2)}\n\nINSTRUCTION:\n${instruction}\n\nReturn only the JSON object.`,
        model: "anthropic/claude-sonnet-4",
        temperature: 0.6,
        maxTokens: 1500,
        timeoutMs: 22_000,
        retryFastFailures: true,
      });
    } catch (e) {
      if (e instanceof OpenRouterError) {
        return NextResponse.json(
          { error: "openrouter_failed", status: e.status, body: e.body },
          { status: 502 },
        );
      }
      return NextResponse.json(
        { error: "improve_failed", message: (e as Error).message },
        { status: 502 },
      );
    }

    const next = (rewrittenBody.body_paragraphs ?? [])
      .filter((p) => p && typeof p.text === "string" && p.text.trim())
      .map((p) => ({ role: (p.role ?? "setup") as BodyParagraph["role"], text: p.text.trim() }));

    // Defensive: count must match. If the LLM dropped or added a paragraph
    // despite the prompt, fall back to swapping just the text positionally.
    if (next.length !== paras.length) {
      console.warn("[improve body-all] paragraph count drifted", {
        got: next.length, want: paras.length,
      });
    }
    if (next.length === 0) {
      return NextResponse.json(
        { error: "empty_rewrite", message: "Model returned no usable paragraphs." },
        { status: 502 },
      );
    }

    // Force the role on each paragraph to match the original order so a
    // hallucinated role rename doesn't desync the studio's role badges.
    const aligned = next.map((p, i) => ({
      role: (paras[i]?.role ?? p.role) as BodyParagraph["role"],
      text: p.text,
    }));

    const bodyPatch: Record<string, unknown> = {
      body_paragraphs: aligned,
      draft_body: joinBody(aligned),
    };
    // Keep cta_text in sync if the last paragraph is the CTA.
    const last = aligned[aligned.length - 1];
    if (last?.role === "cta") {
      bodyPatch.cta_text = last.text;
    }
    if (angle.format === "carousel" && angle.carousel_pdf_path) {
      bodyPatch.carousel_pdf_path = null;
      bodyPatch.carousel_rendered_at = null;
    }

    const { data: updated, error: upErr } = await supabase
      .from("angles")
      .update(bodyPatch)
      .eq("angle_id", angleId)
      .select()
      .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ angle: updated });
  }

  // Resolve the CURRENT text for the LLM and the section label.
  let currentText: string;
  let section: string;
  switch (target) {
    case "hook": {
      const variants = (angle.hook_variants as HookVariant[] | null) ?? [];
      const v = variants[index];
      if (!v) {
        return NextResponse.json({ error: "hook_out_of_range" }, { status: 400 });
      }
      currentText = v.text;
      section = "hook";
      break;
    }
    case "body": {
      const paras = (angle.body_paragraphs as BodyParagraph[] | null) ?? [];
      const p = paras[index];
      if (!p) {
        return NextResponse.json({ error: "paragraph_out_of_range" }, { status: 400 });
      }
      currentText = p.text;
      section = "body_paragraph";
      break;
    }
    case "slide-copy":
    case "slide-image": {
      const slides = (angle.carousel_slides as Slide[] | null) ?? [];
      const slideIdx = index - 1; // slide N is 1-based for the operator
      const slide = slides[slideIdx];
      if (!slide) {
        return NextResponse.json({ error: "slide_out_of_range" }, { status: 400 });
      }
      currentText =
        target === "slide-copy"
          ? slide.headline
          : (slide.image_gen_prompt ?? "");
      section = target === "slide-copy" ? "slide_headline" : "slide_image_prompt";
      // slide-image needs SOME starting text. If image_gen_prompt is empty
      // seed it with the slide's own copy so the LLM has context for the
      // instruction (e.g. "more abstract" can't refine an empty string).
      if (target === "slide-image" && !currentText.trim()) {
        currentText = [slide.headline, slide.supporting, slide.stat]
          .filter((s): s is string => typeof s === "string" && !!s.trim())
          .join(" · ");
      }
      break;
    }
  }

  // Call the LLM. generateText returns plain text; no retry — the route's
  // 30s budget already covers the typical 1–4s call.
  const businessProfile = await getBusinessProfile();
  let rewritten: string;
  try {
    rewritten = await generateText({
      system: refineSectionPrompt(businessProfile),
      user: userPrompt(section, currentText, instruction),
      model: "anthropic/claude-sonnet-4",
      temperature: 0.6,
      maxTokens: 600,
      timeoutMs: 22_000,
    });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "improve_failed", message: (e as Error).message },
      { status: 502 },
    );
  }

  // The model occasionally wraps the rewrite in quotes / a leading
  // "Here is..." despite the prompt. Strip aggressively but conservatively
  // — only the well-known preamble patterns, not anything that looks like
  // legitimate copy.
  rewritten = rewritten
    .trim()
    .replace(/^["“”']|["“”']$/g, "")
    .replace(/^Here(?:'s| is) (?:the |a )?(?:rewritten |revised |updated )?(?:version|text|copy)[:\s—-]*/i, "")
    .trim();

  if (!rewritten) {
    return NextResponse.json(
      { error: "empty_rewrite", message: "Model returned empty content. Try a more specific instruction." },
      { status: 502 },
    );
  }

  // Persist the change.
  const patch: Record<string, unknown> = {};
  let triggeredImageGen: { runId: string } | null = null;

  switch (target) {
    case "hook": {
      const variants = [...((angle.hook_variants as HookVariant[] | null) ?? [])];
      variants[index] = { ...variants[index], text: rewritten };
      patch.hook_variants = variants;
      // If this was the chosen hook, mirror into hook_chosen so the
      // downstream coherence + render path sees the new copy.
      if ((angle.selected_hook_index as number | null) === index) {
        patch.hook_chosen = rewritten;
        patch.hook_alternates = variants
          .filter((_, i) => i !== index)
          .map((v) => v.text)
          .join("\n");
      }
      break;
    }
    case "body": {
      const paras = [...((angle.body_paragraphs as BodyParagraph[] | null) ?? [])];
      paras[index] = { ...paras[index], text: rewritten };
      patch.body_paragraphs = paras;
      patch.draft_body = joinBody(paras);
      // If the rewritten paragraph is the CTA, also update cta_text on the
      // angle row so the badge in the studio stays in sync.
      if (paras[index].role === "cta") {
        patch.cta_text = rewritten;
      }
      // Body change invalidates the rendered carousel PDF if any.
      if (angle.format === "carousel" && angle.carousel_pdf_path) {
        patch.carousel_pdf_path = null;
        patch.carousel_rendered_at = null;
      }
      break;
    }
    case "slide-copy": {
      const slides = [...((angle.carousel_slides as Slide[] | null) ?? [])];
      const slideIdx = index - 1;
      slides[slideIdx] = { ...slides[slideIdx], headline: rewritten };
      patch.carousel_slides = slides;
      patch.carousel_pdf_path = null;
      patch.carousel_rendered_at = null;
      break;
    }
    case "slide-image": {
      const slides = [...((angle.carousel_slides as Slide[] | null) ?? [])];
      const slideIdx = index - 1;
      slides[slideIdx] = { ...slides[slideIdx], image_gen_prompt: rewritten };
      patch.carousel_slides = slides;
      // Auto-fire variant gen so the studio doesn't need a second click.
      // Skip silently if Trigger.dev isn't configured — the studio's
      // existing manual "Generate 4 image variants" button still works.
      if (process.env.TRIGGER_SECRET_KEY) {
        try {
          const handle = await tasks.trigger("generate-slide-images", {
            angleId,
            slideN: index,
          });
          triggeredImageGen = { runId: handle.id };
        } catch (e) {
          console.warn("[improve] auto image-gen trigger failed", e);
        }
      }
      break;
    }
  }

  const { data: updated, error: upErr } = await supabase
    .from("angles")
    .update(patch)
    .eq("angle_id", angleId)
    .select()
    .single();
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  return NextResponse.json({
    rewritten,
    angle: updated,
    image_gen: triggeredImageGen,
  });
}
