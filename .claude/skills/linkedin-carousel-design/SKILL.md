---
name: linkedin-carousel-design
description: Take an approved slide-by-slide outline and apply the Lynx Media visual system — backgrounds, type, color, layout, cross-deck rhythm — producing a per-slide design spec. Use immediately after `linkedin-carousel-outline` produces an approved outline, or when redesigning an old deck without changing copy. Do NOT use before the outline is approved at Gate 2 or for non-carousel formats.
---

# linkedin-carousel-design

Takes a slide-by-slide outline and produces a per-slide design spec — the document the build skill executes against.

## When to invoke

- Immediately after `linkedin-carousel-outline` produces an approved outline (Gate 2 passed)
- A designer (you, or someone on the team) needs a visual brief for an existing outline
- Redesigning an old deck without changing the copy

## When NOT to invoke

- Before the outline is approved at Gate 2 — wasted design effort if copy changes
- For non-carousel formats (text, video, single-image)

## Inputs

| Field | Required | Description |
|---|---|---|
| `outline` | yes | The markdown outline from `linkedin-carousel-outline` |
| `brand_reference` | auto | Loaded from [references/lynx-brand.md](../../../references/lynx-brand.md) |
| `template_path` | no | Path to a master `.pptx` template if available (see brand reference §10.2) |
| `accent_variant` | no | Default = `standard` (Charcoal + Lynx Green). Allow `amazon` (adds Amazon Orange for Amazon-ecosystem posts) |

## Process

1. **Load brand reference in full.** Read [references/lynx-brand.md](../../../references/lynx-brand.md). Locked values: type sizes (§4), color HEX codes (§3), logo placement (§2), color rhythm (§9).
2. **Decide the color rhythm across the deck before designing any individual slide.** Default rhythm in §9 of the brand reference:

   ```
   Charcoal hook → alternating Charcoal/Light Gray for body → ONE Lynx Green slab at recap (slide 8) → Charcoal CTA
   ```

   **Locked rules:**
   - Never two Lynx Green backgrounds in one deck
   - Never two Light Gray slides in a row
   - Hook + CTA always Charcoal
3. **Decide which body slides get the giant stat treatment** (200–280pt Lynx Green numerals). Aim for 1–3 per deck — too many makes it shouty. Pick the most punchy stats from the outline.
4. **Apply per-slide rules:**
   - **Hook slide (1):** Charcoal background. Lynx Green Montserrat Bold all-caps headline at 96–120pt. White Inter Regular subhead at 32–40pt. Type only — no icons.
   - **Problem slide (2):** Light Gray or Charcoal. Headline 56–72pt. Body in 32pt Inter.
   - **Body slides (3–7):** Alternating background. ONE stat in Lynx Green at 200–280pt OR ONE icon in Lynx Green at ~120px. Never both. Body copy ≤ 35 words.
   - **Recap slide (8):** Lynx Green `#C6F21F` slab background. Charcoal type. This is the screenshot slide.
   - **CTA slide (9):** Charcoal. Reader-facing question in Montserrat SemiBold. Comment-CTA in Inter. Logo + URL `lynxmedia.co` bottom-right. No live link.
5. **Lock typography per the brand reference.** Montserrat Bold/SemiBold for headlines and stats. Inter Regular/Medium for body, captions, page indicators.
6. **Logo placement on every slide:** shield-only mark, bottom-left, 60–80px tall. Wordmark version on slides 1, 8, and 9 only.
7. **Page indicator on every slide except 1 and 9.** Format: `3 / 9` in Inter Medium 22pt, Light Gray, bottom-right.
8. **Run the don'ts check:**
   - No more than one Lynx Green slab
   - No Amazon Orange unless `accent_variant = amazon`
   - No lime-on-white text anywhere
   - No shadows / glows / decorative gradients on the logo or anywhere else
   - No more than 35 words per body slide
   - No mixed fonts beyond Montserrat + Inter

## Output format

Write to `temp/outputs/carousels/<YYYY-MM-DD>-<topic-slug>-design.md`. One block per slide, plus a top-of-file deck summary:

```
DECK SUMMARY
  Total slides:       9
  Color rhythm:       Charcoal → Light Gray → Charcoal → Light Gray → Charcoal →
                      Charcoal → Light Gray → LYNX GREEN SLAB → Charcoal
  Lynx Green slabs:   1 (slide 8 only)
  Amazon Orange used: no
  Stat callouts:      Slides 3, 4, 5, 7
  Hero numeral slide: 5 ("$29M managed")

SLIDE 1 — HOOK
  Canvas:          1080 × 1350 (4:5 portrait)
  Background:      Charcoal #1C1C1C
  Headline:        "STUCK AT 15% TACoS? IT'S NOT YOUR BIDS."
                   Montserrat Bold, 110pt, Lynx Green #C6F21F, all-caps
  Subhead:         "Across $29M of managed spend, the same 3 things break first."
                   Inter Regular, 36pt, White #FFFFFF
  Logo:            Shield-only mark, bottom-left, 80px tall
  Page indicator:  (none — hook slide)
  Margins:         80px all sides
  Notes:           No icons or imagery. Type-only. Maximum contrast.

SLIDE 2 — PROBLEM FRAMING
  Canvas:          1080 × 1350
  Background:      Light Gray #F5F5F5
  Headline:        "Your bids aren't the bottleneck. Your structure is."
                   Montserrat SemiBold, 64pt, Charcoal #1C1C1C
  Body:            "[3–5 line reader-state copy from outline]"
                   Inter Regular, 34pt, Charcoal
  Logo:            Shield-only, bottom-left, 80px, Lynx Green
  Page indicator:  "2 / 9", Inter Medium, 22pt, Charcoal at 60% opacity, bottom-right
  Margins:         80px all sides

[continues for slides 3–9]
```

## Anti-patterns

- Lynx Green as a background slab on more than one slide
- Mixing fonts beyond Montserrat + Inter
- Body copy below 28pt — unreadable on mobile
- Page indicators with creative formatting ("Page 3 of 9 ✨") — keep them clinical
- Slides where the eye doesn't immediately know where to go
- Decorative gradients, drop shadows, or texture overlays
- Two stats on one slide (it's a carousel — split it)

## Handoff

Output goes to `linkedin-carousel-build` which produces the actual `.pptx` + `.pdf` file.

## References

- [references/lynx-brand.md](../../../references/lynx-brand.md) — full visual canon
