import "server-only";

/**
 * Deterministic coherence checks for Phase D.
 *
 * Per the project roast: "Replace the 5-axis LLM rubric with deterministic
 * checks + one binary LLM call." This module covers the deterministic
 * half — JS-only checks that don't require any model. The single binary
 * "would you publish this?" call lives in the API route.
 */

export type BodyParagraph = {
  role: string;
  text: string;
};

export type CoherenceCheck = {
  word_count: number;
  char_count: number;
  hook_delivery: { ok: boolean; reason: string };
  cta_match: { ok: boolean; archetype: string; has_link: boolean; reason?: string };
  brand_match: { ok: boolean; average_score: number | null; checked: number };
  voice_grounded: { ok: boolean; samples_used: number };
};

const HOOK_PROMISE_PATTERNS: Array<{ re: RegExp; counter: (body: string) => number; label: string }> = [
  // "5 things / 7 ways / 3 reasons / N {anything}"
  {
    re: /\b(\d+)\s+(?:ways?|reasons?|things?|tactics?|tips?|mistakes?|lessons?|steps?|hacks?|patterns?|tricks?|frameworks?|signals?|shifts?)\b/i,
    counter: (body: string) => {
      // Count numbered list items: "1 — ", "1. ", "1) ", "1 -", "1—"
      const matches = body.match(/(^|\n)\s*\d+\s*[.\)\-—–]/g);
      return matches?.length ?? 0;
    },
    label: "numbered list",
  },
];

export function checkHookDelivery(hook: string, body: string): { ok: boolean; reason: string } {
  for (const p of HOOK_PROMISE_PATTERNS) {
    const m = hook.match(p.re);
    if (m) {
      const promised = parseInt(m[1], 10);
      const found = p.counter(body);
      if (found >= promised) {
        return { ok: true, reason: `promised ${promised} items, body lists ${found}` };
      }
      return {
        ok: false,
        reason: `promised ${promised} but only ${found} ${p.label} items found in body`,
      };
    }
  }
  // No "N items" promise — pass through.
  return { ok: true, reason: "no numeric promise to verify" };
}

export function checkCtaMatch(
  archetype: string | null,
  ctaText: string | null,
  pinComment: string | null,
  dmContext?: {
    dm_response_template: string | null;
    lead_magnet_id: string | null;
    lead_magnet_url: string | null;
  },
): { ok: boolean; archetype: string; has_link: boolean; reason?: string } {
  const text = `${ctaText ?? ""} ${pinComment ?? ""}`.toLowerCase();
  const hasLink =
    /(https?:\/\/|\.[a-z]{2,}\/|\.com|\.co\b|link in)/i.test(text) ||
    /lynxmedia\.co/i.test(text);

  if (!archetype) return { ok: false, archetype: "(none)", has_link: hasLink };

  // DM + comment archetypes drive the engagement-loop auto-reply. If the
  // template references {{lead_magnet_url}} but no magnet is attached,
  // the substitution will produce an empty string at send time.
  function magnetCheck(): { ok: boolean; reason?: string } {
    if (!dmContext) return { ok: true };
    const tpl = dmContext.dm_response_template ?? "";
    const usesPlaceholder = /{{\s*lead_magnet_url\s*}}/.test(tpl);
    const hasMagnet = !!dmContext.lead_magnet_id || !!dmContext.lead_magnet_url;
    if (usesPlaceholder && !hasMagnet) {
      return {
        ok: false,
        reason: "DM template uses {{lead_magnet_url}} but no lead magnet attached",
      };
    }
    return { ok: true };
  }

  switch (archetype) {
    case "click":
    case "demo":
      // Click + demo CTAs require a destination. Pin comment is fine for click.
      return { ok: hasLink, archetype, has_link: hasLink };
    case "dm": {
      const hasKeyword = /\bdm\b.+['"]?[A-Z]{3,}/i.test(text) || /reply\s+\w+/i.test(text);
      const m = magnetCheck();
      return {
        ok: hasKeyword && m.ok,
        archetype,
        has_link: false,
        reason: !hasKeyword
          ? "DM CTA must name a keyword (e.g. \"DM 'THRESHOLD'\")"
          : m.reason,
      };
    }
    case "comment": {
      const m = magnetCheck();
      return { ok: m.ok, archetype, has_link: hasLink, reason: m.reason };
    }
    case "follow":
    default:
      return { ok: true, archetype, has_link: hasLink };
  }
}

export function wordChar(paragraphs: BodyParagraph[] | null): {
  word_count: number;
  char_count: number;
} {
  if (!paragraphs) return { word_count: 0, char_count: 0 };
  let words = 0;
  let chars = 0;
  for (const p of paragraphs) {
    words += p.text.match(/\S+/g)?.length ?? 0;
    chars += p.text.length;
  }
  return { word_count: words, char_count: chars };
}

// average() turns the 4 boolean checks + brand score into a 0..1 number
// the UI can use to gate "Mark Visual Ready". A check that doesn't apply
// (no slides for a text post; no brand score yet) is excluded from the
// average rather than counted as fail.
export function averageCoherence(check: CoherenceCheck): number {
  const parts: number[] = [];
  parts.push(check.hook_delivery.ok ? 1 : 0);
  parts.push(check.cta_match.ok ? 1 : 0);
  parts.push(check.voice_grounded.ok ? 1 : 0);
  if (check.brand_match.checked > 0) {
    parts.push((check.brand_match.average_score ?? 0) / 100);
  }
  if (parts.length === 0) return 0;
  return Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100) / 100;
}
