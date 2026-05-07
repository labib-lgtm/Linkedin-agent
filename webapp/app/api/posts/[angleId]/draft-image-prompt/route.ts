import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateText, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { imagePromptDrafterSystemPrompt } from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// POST /api/posts/[angleId]/draft-image-prompt
//
// Uses Haiku to translate the post body + angle into a concrete visual
// brief (subject, composition, scene) that gpt-image-1 can render
// LITERALLY. Solves the "POST COPY rendered as actual text" failure
// where a meta-prompt produces a meta-image.
//
// Reads from body_paragraphs (rich, specific) before hook_seed
// (one-line) before draft_body (legacy joined text). This gives the
// drafter the full set of named numbers, tactics, tools to pick the
// strongest single metaphor from.
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ angleId: string }> },
) {
  const { angleId } = await ctx.params;
  const supabase = createServiceClient();

  const { data: angle, error } = await supabase
    .from("angles")
    .select("hook_seed, hook_chosen, body_paragraphs, draft_body, gap_filled, format")
    .eq("angle_id", angleId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!angle) return NextResponse.json({ error: "angle_not_found" }, { status: 404 });

  type Paragraph = { role: string; text: string };
  const paragraphs = (angle.body_paragraphs as Paragraph[] | null) ?? [];
  const fullBody =
    paragraphs.length > 0
      ? paragraphs.map((p) => p.text).join("\n\n")
      : (angle.draft_body as string | null) ?? "";

  if (!fullBody.trim() && !angle.hook_seed && !angle.hook_chosen) {
    return NextResponse.json(
      { error: "no_content", message: "Generate copy first — the drafter needs body text to translate." },
      { status: 400 },
    );
  }

  const business = await getBusinessProfile();

  const userPrompt = [
    `Hook: ${angle.hook_chosen || angle.hook_seed || "(none)"}`,
    angle.gap_filled ? `Promise: ${angle.gap_filled}` : null,
    "",
    "Full post body:",
    fullBody || "(empty)",
    "",
    "Translate the strongest single metaphor from the post into a concrete visual brief. Describe what the PICTURE LITERALLY SHOWS — subject, scene, composition. No words/text/labels in the image. Output one plain-text line, no quotes.",
  ]
    .filter(Boolean)
    .join("\n");

  let drafted: string;
  try {
    drafted = await generateText({
      system: imagePromptDrafterSystemPrompt(business),
      user: userPrompt,
      model: "anthropic/claude-haiku-4-5",
      temperature: 0.6,
      maxTokens: 220,
      timeoutMs: 8_000,
    });
  } catch (e) {
    if (e instanceof OpenRouterError) {
      return NextResponse.json(
        { error: "openrouter_failed", status: e.status, body: e.body },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "draft_failed", message: (e as Error).message },
      { status: 500 },
    );
  }

  // Strip wrapping quotes / extra whitespace / leading "The image shows" filler.
  const cleaned = drafted
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/^(the image shows|image:|brief:|visual:)\s*/i, "")
    .trim();

  return NextResponse.json({ prompt: cleaned });
}
