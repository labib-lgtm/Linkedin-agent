import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { postCopySystemPrompt } from "@/lib/prompts";
import { getVoiceSamples, getRecentHooks } from "@/lib/voice";

export const dynamic = "force-dynamic";
// Vercel Pro: 60s ceiling. 30s leaves comfortable headroom for Sonnet
// tail latency (~12s) plus Supabase round-trips + the fast-failure retry.
export const maxDuration = 30;

type CtaArchetype = "follow" | "comment" | "dm" | "click" | "demo";
const CTA_ARCHETYPES: CtaArchetype[] = ["follow", "comment", "dm", "click", "demo"];

type HookVariant = {
  text: string;
  voice_match_score?: number;
  model_self_estimate?: number;
};

type BodyParagraph = {
  role: "hook" | "setup" | "pivot" | "list" | "payoff" | "cta";
  text: string;
};

type GeneratedCopy = {
  hook_variants?: HookVariant[];
  selected_hook_index?: number;
  body_paragraphs?: BodyParagraph[];
  cta_archetype?: string;
  cta_text?: string;
  pin_comment?: string;
  dm_response_template?: string | null;
};

function buildUserPrompt(angle: Record<string, unknown>, ctaArchetype: CtaArchetype): string {
  const lines: string[] = [];
  lines.push(`Pillar: ${angle.pillar ?? "—"}`);
  lines.push(`Format: ${angle.format ?? "text"}`);
  lines.push(`CTA archetype: ${ctaArchetype}`);
  if (angle.cta_keyword) lines.push(`CTA keyword (for dm/comment): ${angle.cta_keyword}`);
  if (angle.gap_filled) lines.push(`Promise / gap filled: ${angle.gap_filled}`);
  lines.push("");
  lines.push(`Approved angle: ${angle.hook_seed ?? angle.hook_chosen ?? "(no angle text — generate from pillar/format alone)"}`);
  if (angle.notes) {
    lines.push(`Notes: ${angle.notes}`);
  }
  lines.push("");
  lines.push("Generate the post per the system prompt's format-specific rules. Return ONLY the JSON object.");
  return lines.join("\n");
}

function inferCtaArchetype(angle: Record<string, unknown>, override?: string): CtaArchetype {
  if (override && (CTA_ARCHETYPES as readonly string[]).includes(override)) {
    return override as CtaArchetype;
  }
  // Heuristic default: keyword present → dm, otherwise click.
  if (angle.cta_keyword) return "dm";
  return "click";
}

function joinBody(paragraphs: BodyParagraph[]): string {
  return paragraphs.map((p) => p.text).join("\n\n").trim();
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  try {
    return await handle(req, ctx);
  } catch (e) {
    console.error("[posts/generate-copy] uncaught", e);
    return NextResponse.json(
      { error: "uncaught", message: (e as Error)?.message ?? String(e) },
      { status: 500 },
    );
  }
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();

  let body: { ctaArchetype?: string; hookOnly?: boolean; ctaOnly?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is fine — defaults apply.
  }

  // Fire angle + businessProfile in parallel — businessProfile doesn't need
  // accountId (it reads global settings) so it can race the angle fetch.
  // Saves ~200-500ms of serial wait on cold-cache requests.
  const [angleRes, businessProfile] = await Promise.all([
    supabase.from("angles").select("*").eq("angle_id", angleId).maybeSingle(),
    getBusinessProfile(),
  ]);
  const { data: angle, error: angleErr } = angleRes;
  if (angleErr) return NextResponse.json({ error: angleErr.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  const accountId = angle.account_id as string | null;
  if (!accountId) {
    return NextResponse.json(
      { error: "no_account_id", message: "angle missing account_id — cannot ground voice" },
      { status: 400 },
    );
  }

  const ctaArchetype = inferCtaArchetype(
    angle as Record<string, unknown>,
    body.ctaArchetype,
  );

  const [voiceSamples, recentHooks] = await Promise.all([
    getVoiceSamples(accountId, 5),
    getRecentHooks(accountId, 30),
  ]);

  let copy: GeneratedCopy;
  try {
    // Haiku 4.5 fits comfortably in Vercel Hobby's 10s ceiling alongside
    // ~6s of Supabase round-trips on cold start. Sonnet 4 was the natural
    // choice but routinely pushed past 9s — the digest's same-shape call
    // had to be split into 3 phases for the same reason.
    copy = await generateJson<GeneratedCopy>({
      system: postCopySystemPrompt(businessProfile, voiceSamples, recentHooks),
      user: buildUserPrompt(angle as Record<string, unknown>, ctaArchetype),
      model: "anthropic/claude-haiku-4-5",
      temperature: 0.7,
      maxTokens: 1500,
      // Vercel Pro: 30s ceiling on the route. 18s on the LLM call leaves
      // ~12s for Supabase + a fast-failure retry. Switch the model to
      // anthropic/claude-sonnet-4 in /settings if you want better copy
      // and can spend the extra ~5-10s of latency.
      timeoutMs: 18_000,
      retryFastFailures: true,
    });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    throw e;
  }

  const hookVariants = (copy.hook_variants ?? [])
    .filter((v) => v && typeof v.text === "string" && v.text.trim())
    .slice(0, 5)
    .map((v) => ({
      text: v.text.trim(),
      voice_match_score:
        typeof v.voice_match_score === "number" ? v.voice_match_score : null,
      model_self_estimate:
        typeof v.model_self_estimate === "number" ? v.model_self_estimate : null,
    }));
  if (hookVariants.length === 0) {
    return NextResponse.json(
      { error: "no_hooks_generated", message: "Model returned zero usable hooks" },
      { status: 502 },
    );
  }

  const selectedIndex = Math.max(
    0,
    Math.min(hookVariants.length - 1, copy.selected_hook_index ?? 0),
  );

  const bodyParagraphs = (copy.body_paragraphs ?? [])
    .filter((p) => p && typeof p.text === "string" && p.text.trim())
    .map((p) => ({
      role: ((p.role ?? "setup") as BodyParagraph["role"]),
      text: p.text.trim(),
    }));

  // Three modes:
  //   hookOnly  — keep body + cta + pin, only update hook variants
  //   ctaOnly   — keep hooks + body, only update cta_archetype + cta_text + pin
  //   default   — full regen
  const patch: Record<string, unknown> = {
    copy_generated_at: new Date().toISOString(),
  };

  if (body.ctaOnly) {
    patch.cta_archetype = ctaArchetype;
    const newCtaText = (copy.cta_text ?? "").trim() || null;
    patch.cta_text = newCtaText;
    patch.pin_comment = (copy.pin_comment ?? "").trim() || null;
    if (ctaArchetype === "dm") {
      patch.dm_response_template = (copy.dm_response_template ?? "").trim() || null;
      patch.dm_template_generated_at = new Date().toISOString();
    } else {
      patch.dm_response_template = null;
    }

    // Propagate the new CTA into the body's last paragraph (role="cta")
    // and rebuild draft_body. Without this, the studio shows the new CTA
    // in the archetype block but the body + slide 7 still read the old
    // copy until the user does a full regen.
    if (newCtaText) {
      const existing = (angle.body_paragraphs as BodyParagraph[] | null) ?? [];
      if (existing.length > 0) {
        const updated = [...existing];
        const lastIdx = updated.length - 1;
        const last = updated[lastIdx];
        if (last && last.role === "cta") {
          updated[lastIdx] = { role: "cta", text: newCtaText };
        } else {
          // No CTA paragraph present — append one so the body ends with the CTA.
          updated.push({ role: "cta", text: newCtaText });
        }
        patch.body_paragraphs = updated;
        patch.draft_body = joinBody(updated);
      }
    }

    // Propagate the new CTA into the last carousel slide (role="cta").
    // Without this, slide 7 keeps its stale headline (e.g. "DM 'HOURS'
    // for the full audit template" after the operator switches to a
    // Comment archetype) and gets rendered into the published PDF
    // verbatim. Leaves visual_element, color_emphasis, layout
    // untouched — only the copy changes.
    if (newCtaText && angle.format === "carousel") {
      const slides =
        (angle.carousel_slides as Array<Record<string, unknown>> | null) ?? [];
      if (slides.length > 0) {
        const lastIdx = slides.length - 1;
        const last = slides[lastIdx];
        if (last && (last.role === "cta" || last.layout === "inverted-cta")) {
          slides[lastIdx] = {
            ...last,
            headline: newCtaText,
            supporting: last.supporting ?? null,
          };
          patch.carousel_slides = slides;
        }
      }
      // Invalidate any rendered PDF — slide 7 changed, the PDF on disk
      // is now wrong. User has to click Render & publish again.
      patch.carousel_pdf_path = null;
      patch.carousel_rendered_at = null;
    }
  } else if (body.hookOnly) {
    patch.hook_variants = hookVariants;
    patch.selected_hook_index = selectedIndex;
    patch.hook_chosen = hookVariants[selectedIndex].text;
    patch.hook_alternates = hookVariants
      .filter((_, i) => i !== selectedIndex)
      .map((h) => h.text)
      .join("\n");
  } else {
    patch.hook_variants = hookVariants;
    patch.selected_hook_index = selectedIndex;
    patch.body_paragraphs = bodyParagraphs;
    patch.cta_archetype = ctaArchetype;
    patch.cta_text = (copy.cta_text ?? "").trim() || null;
    patch.pin_comment = (copy.pin_comment ?? "").trim() || null;
    patch.draft_body = joinBody(bodyParagraphs);
    patch.hook_chosen = hookVariants[selectedIndex].text;
    patch.hook_alternates = hookVariants
      .filter((_, i) => i !== selectedIndex)
      .map((h) => h.text)
      .join("\n");
    if (ctaArchetype === "dm") {
      patch.dm_response_template = (copy.dm_response_template ?? "").trim() || null;
      patch.dm_template_generated_at = new Date().toISOString();
    } else {
      patch.dm_response_template = null;
    }
  }

  // Auto-advance Approved → Drafting on first generation.
  if (angle.status === "Approved") {
    patch.status = "Drafting";
  }

  const { data: updated, error: updErr } = await supabase
    .from("angles")
    .update(patch)
    .eq("angle_id", angleId)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    angle: updated,
    voice_samples_used: voiceSamples.length,
    cta_archetype: ctaArchetype,
  });
}
