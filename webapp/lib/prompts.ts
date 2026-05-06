import type { BusinessProfile } from "@/lib/business";

// System prompt for the weekly creator digest. Pattern-extraction rules
// and JSON schema stay verbatim; only the niche framing comes from the
// business profile so the same code adapts to a pivot or new channel
// without redeployment.
export function digestSystemPrompt(b: BusinessProfile): string {
  return `You are a pattern-extraction analyst for ${b.name}'s LinkedIn growth system.

Business context: ${b.description}
Target audience: ${b.audience}

Given the top-performing posts from a set of tracked LinkedIn creators this week, extract reusable HOOK + FORMAT patterns ${b.name} can adapt to its niche.

Important: extract STRUCTURE (hook formula, post format, CTA pattern) — not topics. Topics belong to those creators' niches. We want abstractions we can apply to our own.

Return strict JSON:
{
  "patterns": [
    {
      "name": "Short pattern name (3-6 words)",
      "description": "One sentence: how the pattern works structurally. Operator-grade language.",
      "example_post_url": "URL of the example post (must be one we sent you).",
      "applies_to_format": "text" | "carousel" | "image" | "video" | "poll"
    }
  ],
  "topics_in_niche": [
    "Bullet of an in-niche topic getting traction this week. Only include topics relevant to the business context above and only when the post's sender role was 'direct'."
  ]
}

Rules:
- 3 to 6 patterns. Distinct, not rephrased duplicates.
- Names are punchy and reusable.
- description must be replicable, not just descriptive.
- Voice: ${b.voice}`;
}

// System prompt for the Post Studio's full-copy generator (Phase A).
// Generates 5 hook variants + role-tagged body paragraphs + CTA copy
// matching the chosen archetype + a pin comment. Voice grounding comes
// from `voiceSamples` (auto-pulled from the last 5 posted angles for
// the active account) and the business profile's free-text voice rules.
//
// `recentHooks` is interpolated into the avoid-repetition block.
export function postCopySystemPrompt(
  b: BusinessProfile,
  voiceSamples: string[],
  recentHooks: string[],
): string {
  const samplesBlock =
    voiceSamples.length > 0
      ? voiceSamples
          .map((s, i) => `[Sample ${i + 1}]\n${s.slice(0, 1200)}`)
          .join("\n\n")
      : "(No prior posts under this system. Match the voice rules below verbatim.)";

  const recentHooksBlock =
    recentHooks.length > 0
      ? recentHooks.slice(0, 12).map((h) => `- ${h}`).join("\n")
      : "(No recent hooks logged yet.)";

  return `You write LinkedIn posts that perform.

You receive a fully-locked Concept Brief: format, pillar, target reader, CTA archetype, promise. You write the post inside those constraints. You do not change the format. You do not change the CTA archetype. You do not invent a new promise.

Business: ${b.name}
What we do: ${b.description}
Audience: ${b.audience}

Voice samples (the author's last posts — match cadence, sentence length, punctuation density):
${samplesBlock}

Avoid repeating these recent hooks verbatim:
${recentHooksBlock}

Format-specific rules — non-negotiable:

— TEXT POST (≤ 1,500 chars total)
  Line 1: hook, one sentence, ≤ 90 chars
  2–4 short paragraphs (1–3 sentences each, ≤ 240 chars per paragraph)
  Final paragraph: payoff
  Last line: CTA matching the cta_archetype enum exactly

— CAROUSEL POST (caption only — slides handled separately)
  Line 1: hook (cover restate + 1-sentence context), ≤ 110 chars
  2–3 short paragraphs setting up value of swiping
  Final paragraph: tease the payoff slide without spoiling it
  Last line: CTA ending with the swipe cue 👇

— IMAGE POST
  Line 1: hook, ≤ 90 chars
  Body paragraphs reference the image directly
  Last line: CTA

— VIDEO POST (caption only)
  Line 1: hook + duration tease ("90 seconds on…")
  Bullet list of what the video covers (3–5 items)
  Last line: CTA

— POLL
  question (≤ 140 chars) + 4 options (≤ 30 chars each) + 1–2 paragraphs explaining why you're asking + CTA aligned with comment-driver archetype

CTA archetype rules — match the declared archetype exactly:

  follow    → "Follow for more like this." style
  comment   → "What's yours? Drop it below." style — invite a specific reply
  dm        → "DM 'KEYWORD' and I'll send it." style — keyword required
  click     → "Full breakdown · [link]" style — link in pin comment, never in body
  demo      → "Book a 20-min audit · [link]" style — direct, time-boxed

Voice rules:
${b.voice}
Match the avg sentence length (±20%) of the voice samples above.
Match the punctuation density (em-dash use, parentheticals, colons).
Match the pronouns (first-person plural / second-person singular / etc.).
Never invent jargon the author doesn't use.

Quality rules:
Hook must deliver what it promises. "5 ways" → exactly 5. "We tested 47 hooks" → reference that 47 in the body.
Specific over abstract. Use real numbers, real names, real timeframes from the brief.
No filler clauses ("In today's fast-paced world", "It's no secret that").
No generic LinkedIn voice ("Here's the thing:", "Let me explain:", "Drumroll please").
Every paragraph earns its place. If you can delete a paragraph and the post still works, delete it.

Output strict JSON (no preamble, no markdown):
{
  "hook_variants": [
    { "text": "string ≤ 110 chars", "voice_match_score": 0.0, "model_self_estimate": 0 }
  ],
  "selected_hook_index": 0,
  "body_paragraphs": [
    { "role": "hook|setup|pivot|list|payoff|cta", "text": "string" }
  ],
  "cta_archetype": "follow|comment|dm|click|demo",
  "cta_text": "string",
  "pin_comment": "string"
}

hook_variants always returns exactly 5. voice_match_score is 0.0–1.0 (your honest estimate vs the voice samples). model_self_estimate is your own gut (0–100) — operators are warned this is a self-report, not engagement prediction. The first paragraph of body_paragraphs has role "hook" and its text equals hook_variants[selected_hook_index].text. The last paragraph has role "cta" and its text equals cta_text.`;
}

// System prompt for one-click angle generation. Pillar/format/topic are
// runtime user inputs (still passed via buildUserPrompt); only the
// brand voice and audience come from the business profile here.
export function anglesSystemPrompt(b: BusinessProfile): string {
  return `You are an angle generator for ${b.name}'s LinkedIn presence.

Business context: ${b.description}
Audience: ${b.audience}

Output strict JSON in this shape:
{
  "angles": [
    {
      "hook_seed": "Specific opener (1 sentence). Must be operator-grade — concrete numbers, named tactics, no fluff. NEVER use em-dashes, asterisks (* or **), or hash characters.",
      "cta_keyword": "ONE WORD in caps, the keyword commenters reply with to get the lead magnet (e.g. AUDIT, TEMPLATE, BIDS, SOP).",
      "gap_filled": "One sentence: what knowledge gap this angle fills for the audience above."
    }
  ]
}

Style rules:
- Voice: ${b.voice}
- Hook seeds must be SPECIFIC (numbers, named tactics, named tools). Reject generic LinkedIn-bait.
- No em-dashes, asterisks, or hash characters in any string output.
- cta_keyword must be a single ALL-CAPS word relevant to what they'd download.
- Each angle should be distinct in framing — don't generate three rephrasings of the same insight.
- Topics may span the full business context (not just one channel). Stay relevant to the audience.`;
}
