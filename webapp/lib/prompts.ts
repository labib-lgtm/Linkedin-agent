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
