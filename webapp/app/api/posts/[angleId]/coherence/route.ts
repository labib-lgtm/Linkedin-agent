import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { publishCheckSystemPrompt } from "@/lib/prompts";
import { getVoiceSamples } from "@/lib/voice";
import {
  averageCoherence,
  checkCtaMatch,
  checkHookDelivery,
  wordChar,
  type CoherenceCheck,
} from "@/lib/coherence";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

type BodyParagraph = { role: string; text: string };

type PublishCheck = {
  publishable?: boolean;
  reason?: string;
};

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  try {
    return await handle(ctx);
  } catch (e) {
    console.error("[posts/coherence] uncaught", e);
    return NextResponse.json(
      { error: "uncaught", message: (e as Error)?.message ?? String(e) },
      { status: 500 },
    );
  }
}

async function handle(ctx: { params: Promise<{ angleId: string }> }) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();

  const { data: angle, error } = await supabase
    .from("angles")
    .select("*")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  const paragraphs = (angle.body_paragraphs as BodyParagraph[] | null) ?? [];
  const hook =
    (angle.hook_chosen as string | null) ??
    paragraphs.find((p) => p.role === "hook")?.text ??
    "";
  const joinedBody = paragraphs.map((p) => p.text).join("\n\n");
  const accountId = angle.account_id as string | null;

  const wc = wordChar(paragraphs);
  const hookDelivery = checkHookDelivery(hook, joinedBody);
  const ctaMatch = checkCtaMatch(
    angle.cta_archetype as string | null,
    angle.cta_text as string | null,
    angle.pin_comment as string | null,
    {
      dm_response_template: angle.dm_response_template as string | null,
      lead_magnet_id: (angle.lead_magnet_id as string | null) ?? null,
      lead_magnet_url: (angle.lead_magnet_url as string | null) ?? null,
    },
  );

  // Brand match: average brand_score across picked variants for this angle.
  let brandAvg: number | null = null;
  let brandChecked = 0;
  const { data: pickedAssets } = await supabase
    .from("post_assets")
    .select("brand_score")
    .eq("angle_id", angleId)
    .not("picked_at", "is", null);
  if (pickedAssets && pickedAssets.length > 0) {
    const scored = pickedAssets.filter((a) => typeof a.brand_score === "number");
    if (scored.length > 0) {
      brandAvg = Math.round(
        scored.reduce((s, a) => s + (a.brand_score as number), 0) / scored.length,
      );
    }
    brandChecked = pickedAssets.length;
  }

  // Voice grounded: do we have at least 3 voice samples (real or seeded)?
  const voiceSamples = accountId ? await getVoiceSamples(accountId, 5) : [];

  const baseCheck: CoherenceCheck = {
    word_count: wc.word_count,
    char_count: wc.char_count,
    hook_delivery: hookDelivery,
    cta_match: ctaMatch,
    brand_match: { ok: (brandAvg ?? 0) >= 60, average_score: brandAvg, checked: brandChecked },
    voice_grounded: { ok: voiceSamples.length >= 3, samples_used: voiceSamples.length },
  };

  // Single binary LLM call. If any deterministic check failed, skip the
  // LLM call — we already have a "no" without paying for it.
  const detPass =
    baseCheck.hook_delivery.ok &&
    baseCheck.cta_match.ok &&
    baseCheck.voice_grounded.ok;

  let publishable: { ok: boolean; reason: string; model?: string } = {
    ok: false,
    reason: "Deterministic check failed — fix flagged issues first.",
  };

  if (detPass) {
    try {
      const business = await getBusinessProfile();
      const result = await generateJson<PublishCheck>({
        system: publishCheckSystemPrompt(business),
        user: [
          `Hook: ${hook}`,
          "",
          `Body:\n${joinedBody}`,
          "",
          `CTA archetype: ${angle.cta_archetype ?? "—"}`,
          `CTA copy: ${angle.cta_text ?? ""}`,
          `Pin comment: ${angle.pin_comment ?? ""}`,
          "",
          "Decide. Return strict JSON.",
        ].join("\n"),
        model: "anthropic/claude-haiku-4-5",
        temperature: 0.2,
        maxTokens: 200,
        timeoutMs: 9_000,
      });
      publishable = {
        ok: !!result.publishable,
        reason: (result.reason ?? "").slice(0, 280),
        model: "anthropic/claude-haiku-4-5",
      };
    } catch (e) {
      if (e instanceof OpenRouterError) {
        publishable = { ok: false, reason: `LLM error: ${e.message}` };
      } else {
        publishable = { ok: false, reason: `LLM error: ${(e as Error).message}` };
      }
    }
  }

  const scores = {
    ...baseCheck,
    publishable,
    average: averageCoherence(baseCheck) * (publishable.ok ? 1 : 0.6),
  };

  const { data: updated, error: updErr } = await supabase
    .from("angles")
    .update({
      coherence_scores: scores,
      coherence_checked_at: new Date().toISOString(),
    })
    .eq("angle_id", angleId)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ angle: updated, scores });
}
