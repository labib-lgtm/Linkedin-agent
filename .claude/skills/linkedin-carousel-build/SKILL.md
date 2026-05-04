---
name: linkedin-carousel-build
description: Take an approved per-slide design spec and produce the actual `.pptx` + `.pdf` files ready for LinkedIn document upload. Use after `linkedin-carousel-design` produces a spec, when re-rendering after a spec edit, or when converting an existing spec into a `.pptx` for the first time. Wraps the existing `pptx` skill — do NOT re-implement deck-generation logic. Skip when the user is doing visuals in Canva/Figma instead.
---

# linkedin-carousel-build

Takes a per-slide design spec and produces the actual `.pptx` + `.pdf` files ready for LinkedIn upload as a document post.

## When to invoke

- After `linkedin-carousel-design` produces an approved spec
- When re-rendering a deck after the spec is edited
- When converting an old design spec into a `.pptx` for the first time

## When NOT to invoke

- Before the design spec is approved
- For decks where the visual work happens in Canva, Figma, or another tool — in those cases the design spec from `linkedin-carousel-design` is the deliverable and this skill is skipped

## Inputs

| Field | Required | Description |
|---|---|---|
| `design_spec` | yes | The markdown spec from `linkedin-carousel-design` |
| `brand_assets_path` | yes | Path to folder containing `lynx-shield.png`, `lynx-wordmark.png`, brand fonts (see brand reference §10.1) |
| `template_path` | no | Path to a Lynx master `.pptx` template — speeds up build and locks consistency (see §10.2) |
| `output_path` | no | Default = `temp/outputs/carousels/<YYYY-MM-DD>-<topic-slug>.pptx` |
| `also_export_pdf` | no | Default = `true`. LinkedIn document posts upload as PDF. |

## Process

1. **Load the existing `pptx` skill.** Read `pptx/SKILL.md` first — it contains the canonical instructions for producing high-quality `.pptx` files. **Do not duplicate that skill's logic.** Call its scripts.
2. **Load brand assets.** Verify the shield, wordmark, and fonts exist at `brand_assets_path`. Fail loudly if missing — don't render with placeholders.
3. **If `template_path` is provided:** open it as the base and use its slide masters. Otherwise build a fresh deck with these properties:
   - Slide size: 1080 × 1350 px (set as 11.25" × 14.06" at 96 DPI)
   - Default font: Montserrat (fallback Inter for body)
   - Background: set per slide from the spec
4. **For each slide block in the design spec, render:**
   - Background fill (from spec's `Background` line)
   - Headline text frame at exact size, weight, color
   - Subhead/body text frames per spec
   - Logo image at spec's position and size
   - Page indicator text frame (skip on slides 1 and 9)
   - Stat callout if present (giant Lynx Green numeral)
5. **Embed fonts** if the deck will be opened on a machine without Montserrat/Inter installed. Otherwise alias to web-safe fallbacks (cleanup pass before export).
6. **Run validation** (lifted from the `pptx` skill):
   - Every text frame within margins
   - No text below 28pt
   - No images stretched beyond native aspect ratio
   - Logo present on every slide
   - Page indicator present on slides 2–8
   - Color values match [references/lynx-brand.md](../../../references/lynx-brand.md) §3 exactly
7. **Export PDF** using the `pptx` skill's PDF export. Verify:
   - PDF < 10 MB (LinkedIn document limit)
   - ≤ 300 pages (irrelevant here, but check)
   - Embedded fonts render correctly
8. **Return both file paths** plus a one-line summary: slide count, hex colors used, fonts embedded, file size.

## Output

- `<output_path>.pptx` — editable PowerPoint file
- `<output_path>.pdf` — flattened PDF for LinkedIn upload (when `also_export_pdf = true`)
- stdout summary block:

```
BUILD COMPLETE
  Slides:        9
  Colors:        #1C1C1C, #C6F21F, #F5F5F5, #FFFFFF
  Fonts:         Montserrat (embedded), Inter (embedded)
  PPTX size:     1.4 MB
  PDF size:      0.9 MB
  PPTX path:     temp/outputs/carousels/2026-05-04-tacos-ceiling.pptx
  PDF path:      temp/outputs/carousels/2026-05-04-tacos-ceiling.pdf
```

## Anti-patterns

- Re-implementing logic that already exists in the `pptx` skill — **call it instead**
- Skipping validation
- Embedding huge logo PNGs (use SVG or compressed PNG ≤ 100 KB)
- Hard-coded color values that don't match [references/lynx-brand.md](../../../references/lynx-brand.md) — always pull from the brand reference, never from memory
- Adding "creative" elements not in the design spec. **This skill executes; it does not invent.**
- Failing silently when assets are missing — fail loudly, name the missing path

## Handoff

Output `.pdf` goes to `linkedin-content-calendar` ([06_content_calendar.md](../../../workflows/06_content_calendar.md)) which slots it into the week's posting schedule. From there, [07_publish.md](../../../workflows/07_publish.md) uploads it via Unipile.

## References

- `pptx` skill (existing, on the user's machine) — canonical `.pptx` generation
- [references/lynx-brand.md](../../../references/lynx-brand.md) — color and typography canon
- [workflows/06_content_calendar.md](../../../workflows/06_content_calendar.md) — next step in the chain
