---
name: linkedin-image-asset
description: For single-image LinkedIn posts, produce either a design brief (for a human designer or Canva session) or an AI image prompt (Midjourney / DALL·E / etc.) — selected by an input flag. Three archetypes — stat-slab, before-after, industrial. Use when a topic is slotted as a single-image format, or when the user asks "design brief for this image post" or "Midjourney prompt for [topic]." Do NOT use for carousels (chain `linkedin-carousel-outline` → `-design` → `-build`), video, or when uploading a photo as-is with no styling.
---

# linkedin-image-asset

Produces design briefs or AI image prompts for single-image LinkedIn posts. Lighter-weight than carousel/video — meant for fast turnaround.

## When to invoke

- An approved post topic is slotted as a single-image format
- Direct ask: "design brief for this image post," "Midjourney prompt for [topic]"
- When you want a quick visual instead of a full carousel

## When NOT to invoke

- For carousel posts (route through `linkedin-carousel-outline` → `-design` → `-build`)
- For video posts
- When a hand-shot or stock photo will be used as-is with no styling — just upload directly

## Inputs

| Field | Required | Description |
|---|---|---|
| `topic` | yes | The approved post topic |
| `archetype` | yes | One of: `stat-slab` / `before-after` / `industrial` |
| `output_mode` | yes | `brief` (for a designer) or `ai-prompt` (for Midjourney/DALL·E/etc.) |
| `key_text` | yes if `archetype = stat-slab` | The exact words on the image (max 12 words; ideally one stat + one supporting line) |
| `image_dimensions` | no | Default = `1200 × 1500` (LinkedIn in-feed image post). Allow `1200 × 628` (link-card) |

## The three archetypes

Per [references/lynx-brand.md](../../../references/lynx-brand.md) §8:

### A. `stat-slab` — single stat hero image
- Charcoal background (`#1C1C1C`)
- One giant Lynx Green numeral (Montserrat Bold, ~40% canvas height)
- One supporting line of Inter Regular white text below
- Shield logo bottom-right, 8% canvas height
- **Use case:** hook posts, drop-stat posts, "we managed $29M and learned X" posts

### B. `before-after` — two-panel data viz
- Two-panel split (50/50 vertical or 60/40)
- Left panel: dashed/red trend line on Light Gray (`#F5F5F5`)
- Right panel: solid Lynx Green up-and-to-the-right line on Charcoal
- Headline label across top: "Before / After: [metric]"
- **Honest data only — no fabricated numbers, ever**
- **Use case:** client outcome posts (anonymized), case studies

### C. `industrial` — real-world / operational photography
- Real photo, slight grit, performance-grade — echoes the shipping-container imagery in the brand applications
- Lynx Green accent in-frame (green container, sign, hard-hat, label)
- Optional Charcoal slab in lower third with Lynx Green Montserrat headline overlay
- **Use case:** founder-mode posts, "behind the systems" posts, brand-pillar storytelling

## Process

1. **Load brand reference.** Read [references/lynx-brand.md](../../../references/lynx-brand.md) §3 (colors), §4 (typography), §8 (archetypes).
2. **Validate archetype + topic match.**
   - **Stat-slab** needs a single, punchy stat. If the topic doesn't have one, stop and ask the user.
   - **Before-after** needs a real metric movement. **No fabricated numbers — ever.**
   - **Industrial** needs a scene that connects to the topic. A port shot for a "we ship results" post is fine; a port shot for a PPC tactics post is incoherent.
3. **Choose canvas.** Default to `1200 × 1500` (4:5 portrait) — this is what LinkedIn favors in-feed. Use `1200 × 628` only for link-style cards (rarely the right format because of the link-reach penalty).
4. **Write the text on image.** ≤ 12 words total. One stat in the largest type, one supporting line below. **No CTAs in image text** — those go in the post body or first comment.
5. **Build the brief or prompt** (templates below). Be concrete, never use placeholders in the final output.
6. **Add a "what could go wrong" callout** at the end — one line flagging the most likely failure mode for this specific image (e.g., "watch out: 'before' line in Light Gray on Light Gray background is hard to see — make it Charcoal dashed instead").

## Output formats

### Mode 1 — `output_mode = brief`

Write to `temp/outputs/images/<YYYY-MM-DD>-<topic-slug>-brief.md`:

```
DESIGN BRIEF — <topic-slug>
  Archetype:      [stat-slab | before-after | industrial]
  Dimensions:     1200 × 1500
  Subject:        [what's in the image]
  Composition:    [layout + focal point + rule-of-thirds notes]
  Text on image:  "[exact words, max 12]"
  Typography:     Montserrat Bold for headlines / numerals · Inter Regular for body
  Colors:         Lynx Green #C6F21F (accent only) · Charcoal #1C1C1C (base) ·
                  White #FFFFFF (body text on dark) · Light Gray #F5F5F5 (alt panel)
  Logo:           Shield-only, bottom-right, 8% canvas height, Lynx Green on dark
  Don'ts:         No shadows/glows · no Amazon Orange unless Amazon UI is shown ·
                  no decorative gradients · no lime-on-white text · no clip-art icons
  Export:         PNG 24-bit, sRGB, ≤ 1 MB
  Reference:      [link to a similar past post if available]

WATCH OUT: [one-line flag of the likely failure mode for this image]
```

The brief should be runnable in Canva by someone who has never seen the deck before.

### Mode 2 — `output_mode = ai-prompt`

Write to `temp/outputs/images/<YYYY-MM-DD>-<topic-slug>-ai-prompt.md`:

```
PROMPT
  [vivid description of the archetype, scene, focal point]
  [color direction: lime green #C6F21F accent on charcoal base]
  [composition: rule of thirds, depth, sharp focus]
  [style: editorial, performance brand, clean industrial]
  [aspect ratio]

NEGATIVE PROMPT
  blurry, low contrast, generic stock, watermarks, text artifacts,
  cliché business handshake, abstract gradient backgrounds, neon over-glow,
  cartoonish, fantasy elements, motion blur

POST-PROCESS
  Add Lynx Green text overlay in Montserrat Bold per the design brief
  Add shield logo bottom-right
  (AI rarely renders text correctly — overlay text after generation)

WATCH OUT: [one-line flag of the likely failure mode for this prompt]
```

**Be visually specific** (camera angle, lighting, depth-of-field) but **lock colors to the Lynx palette**. **Always include the negative-prompt block.** **Always note that text should be overlaid post-generation** — AI image models still mangle typography.

## Anti-patterns

- Fabricated client metrics in `before-after` images. **Honest data only.**
- AI prompts that rely on the model to generate text — it always fails. Overlay text after.
- Stock-photo handshake / boardroom / "happy diverse team" imagery. Off-brand for a performance agency.
- Lime green on a white background — breaks the contrast rule
- Putting a CTA inside the image. CTAs go in the post body, then in the first comment
- Using Amazon Orange outside a literal Amazon UI / Amazon Ads context
- Multiple stats in one image. Stat-slab = one stat. If you need two stats, it's a carousel.

## Handoff

Output goes to `linkedin-content-calendar` ([06_content_calendar.md](../../../workflows/06_content_calendar.md)) which slots the post into the schedule.

- If `output_mode = brief` — the brief is the deliverable for your designer; the resulting PNG comes back from the designer and gets attached at the calendar step
- If `output_mode = ai-prompt` — the prompt is run, the AI output is text-overlaid in Canva/Figma, and the final PNG attaches at the calendar step

## References

- [references/lynx-brand.md](../../../references/lynx-brand.md) §3, §4, §8
- [temp/resources/winners_memory.md](../../../temp/resources/winners_memory.md) — winning patterns to reinforce in image text
