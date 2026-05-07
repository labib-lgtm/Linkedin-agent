import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { postCopySystemPrompt } from "@/lib/prompts";
import { getVoiceSamples, getRecentHooks } from "@/lib/voice";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

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

  const { data: angle, error: angleErr } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", angleId)
    .maybeSingle();
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

  const [businessProfile, voiceSamples, recentHooks] = await Promise.all([
    getBusinessProfile(),
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
      timeoutMs: 8_000,
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
    patch.cta_text = (copy.cta_text ?? "").trim() || null;
    patch.pin_comment = (copy.pin_comment ?? "").trim() || null;
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
