import { NextResponse, type NextRequest } from "next/server";
import { generateJson, OpenRouterError } from "@/lib/openrouter";
import { getBusinessProfile } from "@/lib/business";
import { getVoiceSamples } from "@/lib/voice";
import { getActiveAccountId } from "@/lib/active-account";
import {
  quickPostSystemPrompt,
  QUICK_HOOK_STYLES,
  type QuickHookStyle,
} from "@/lib/prompts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VALID_HOOK_STYLES = new Set(QUICK_HOOK_STYLES.map((s) => s.value));

// Belt-and-suspenders strip of the banned characters even though the prompt
// forbids them. Same logic the comment drafter uses.
function sanitizeBody(text: string): string {
  return text
    .replace(/[—–]/g, "-")
    .replace(/\*/g, "")
    .replace(/#/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// POST /api/angles/quick-draft
//
// Body: { brief, hook_style, char_limit, pillar?, cta_keyword? }
// Returns: { body, character_count }
//
// Composes a single polished post body in the operator's voice that fits
// the requested character cap and opens with the requested hook style.
// If the model overruns the cap, re-prompts once to trim.
export async function POST(req: NextRequest) {
  let body: {
    brief?: string;
    hook_style?: string;
    char_limit?: number;
    pillar?: string | null;
    cta_keyword?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const brief = (body.brief ?? "").trim();
  if (brief.length < 5) {
    return NextResponse.json({ error: "brief_too_short" }, { status: 400 });
  }
  const hookStyle = body.hook_style as QuickHookStyle;
  if (!VALID_HOOK_STYLES.has(hookStyle)) {
    return NextResponse.json(
      { error: "invalid_hook_style", allowed: [...VALID_HOOK_STYLES] },
      { status: 400 },
    );
  }
  const charLimit = Math.max(60, Math.min(3000, Math.floor(Number(body.char_limit) || 0)));
  if (charLimit < 60) {
    return NextResponse.json({ error: "char_limit_required" }, { status: 400 });
  }

  const accountId = await getActiveAccountId();
  const [business, samples] = await Promise.all([
    getBusinessProfile(),
    getVoiceSamples(accountId, 3),
  ]);

  const system = quickPostSystemPrompt(business, samples, {
    hook_style: hookStyle,
    char_limit: charLimit,
  });

  const pillarLine = body.pillar ? `Pillar: ${body.pillar}` : "Pillar: none";
  const ctaLine = body.cta_keyword
    ? `CTA keyword: ${body.cta_keyword} — end with one clean CTA line referencing this keyword.`
    : "CTA keyword: none — do not force a CTA.";

  const userMsg = [
    "Brief / context:",
    "---",
    brief.slice(0, 4000),
    "---",
    "",
    pillarLine,
    ctaLine,
    "",
    `Write the post now. Hook style: ${hookStyle}. Hard cap: ${charLimit} characters.`,
    "Output only the JSON.",
  ].join("\n");

  let draft: { body?: string };
  try {
    draft = await generateJson<{ body?: string }>({
      system,
      user: userMsg,
      model: "anthropic/claude-haiku-4-5",
      temperature: 0.5,
      maxTokens: Math.min(800, Math.ceil(charLimit / 3) + 120),
      timeoutMs: 25_000,
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
      { error: "draft_failed", message: (e as Error).message },
      { status: 500 },
    );
  }

  let finalBody = sanitizeBody((draft.body ?? "").trim());

  // One retry if the model overran the cap. Otherwise the user has to
  // click Compose again, which costs another LLM call AND restarts the
  // temperature roll — better to give the model one chance to trim itself.
  if (finalBody.length > charLimit) {
    try {
      const trim = await generateJson<{ body?: string }>({
        system,
        user: [
          "Brief / context:",
          "---",
          brief.slice(0, 4000),
          "---",
          "",
          pillarLine,
          ctaLine,
          "",
          `Previous draft was ${finalBody.length} chars, over the ${charLimit} hard cap. Rewrite it under ${charLimit} chars while keeping the ${hookStyle} hook on line 1 and the strongest specific up front. Cut filler, not substance.`,
          "",
          "Previous draft:",
          finalBody,
          "",
          "Output only the JSON.",
        ].join("\n"),
        model: "anthropic/claude-haiku-4-5",
        temperature: 0.3,
        maxTokens: Math.min(800, Math.ceil(charLimit / 3) + 80),
        timeoutMs: 20_000,
      });
      const trimmed = sanitizeBody((trim.body ?? "").trim());
      if (trimmed && trimmed.length <= charLimit) finalBody = trimmed;
    } catch {
      // Keep the over-cap draft; UI shows the count so the operator can hand-trim.
    }
  }

  return NextResponse.json({
    body: finalBody,
    character_count: finalBody.length,
    over_cap: finalBody.length > charLimit,
  });
}
