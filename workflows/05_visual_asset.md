# 05 — Visual Asset

## Objective
Produce the visual companion for an approved post: a single image, a 9-slide carousel, or a poll. Native video is deferred — not in scope.

## When to run
**After Gate 2 approval** of the draft from [04_post_writer.md](04_post_writer.md), only when `format ∈ {image, carousel, poll}`. Skip for `text`.

The trigger is explicit: the user says "go" after reviewing the draft in chat. 05 does not auto-fire from 04.

## Project decisions (locked 2026-05-04)

- **Image model:** `openai/gpt-5-image-mini` via OpenRouter, called through [tools/openrouter_client.py](../tools/openrouter_client.py). Model ID set in `.env` as `OPENROUTER_IMAGE_MODEL`. OpenRouter routes the request via its chat-completions endpoint with `modalities: ["image", "text"]` and returns the PNG as a base64 data URI.
- **No logo on any rendered asset.** Brand reference §2 documents the logo for other surfaces, but every LinkedIn asset produced here ships without a shield or wordmark mark. When invoking `linkedin-image-asset` strip the "Shield logo bottom-right" line and the "Add shield logo bottom-right" post-process step. When invoking the carousel chain, omit the logo line on every slide spec block and skip the "logo present on every slide" validation in `linkedin-carousel-build`.
- **Images must be publish-ready, not background-only.** The AI render must include every visible element — hero stats, supporting copy, charts, accents — fully rendered by the model. Do **not** produce empty canvases or "negative space designed for overlay" intended for later text injection in Canva. The `linkedin-image-asset` skill's default suggestion to overlay text post-generation is overridden for this project: describe the exact text content, font, weight, color, and placement directly in the PROMPT block, and remove "text/letters/numbers/typography/words" from the NEGATIVE PROMPT block (those are now required output, not failure modes). If the AI garbles a render, re-prompt with stronger typography description rather than falling back to overlay.
- **No `brand_assets_path`** for this project. Carousel `.pptx` rendering uses HEX colors and Montserrat/Inter via system or web-safe fallback only.

## Inputs (from the Sheet, via the dispatcher)

The dispatcher (`tools/gen_visual_asset.py`) reads the angle row and prints:

- `angle_id`, `pillar`, `format`, `hook_chosen`, `draft_body`, `cta_keyword`, `winner_patterns`, `slide_outline`
- `image_size` — only when `format = image`; resolved from the `image_size` column on the angles tab
- `asset_dir` — `temp/outputs/assets/<angle_id>/` (auto-created)
- `next_steps` — format-specific instructions

### `image_size` column (column V on the angles tab)

Only relevant when `format = image`. Tells the renderer what aspect to produce.

| Cell value | Sent to model | LinkedIn use case |
|---|---|---|
| empty (default) | `1024x1536` | 4:5 portrait — LinkedIn's favored in-feed ratio |
| `portrait` | `1024x1536` | same as default |
| `square` | `1024x1024` | 1:1 in-feed, slightly less reach |
| `landscape` | `1536x1024` | 1.91:1 link-card style, rarely the right call |
| raw `WxH` (e.g. `1024x1024`) | passes through verbatim | escape hatch for other models or non-standard sizes |

Anything else fails the dispatcher with the accepted vocab. To add the column to an existing Sheet, run `python3 tools/migrate_add_image_size.py` once.

## Tools

| Tool | What it does |
|---|---|
| [tools/gen_visual_asset.py](../tools/gen_visual_asset.py) | Dispatcher. Reads angle from Sheet, branches on format, prints next steps, flips status `Drafted → Visualizing`. |
| [tools/gen_image_render.py](../tools/gen_image_render.py) | Wraps `openrouter_client.generate_image`. Reads the prompt produced by `linkedin-image-asset`, calls OpenRouter, saves PNG. |
| [tools/gen_poll_options.py](../tools/gen_poll_options.py) | Writes a structured `poll.md` (question + 3-4 options + comment-prompt). |
| [tools/sheets_mark_visual_ready.py](../tools/sheets_mark_visual_ready.py) | Flips `Visualizing → Visual Ready`, writes `asset_path` back to Sheet. |
| `linkedin-image-asset` skill | Produces the AI prompt or design brief for a single image. |
| `linkedin-carousel-outline` skill | 9-slide content outline (copy only). |
| `linkedin-carousel-design` skill | Per-slide design spec (colors, type, layout). |
| `linkedin-carousel-build` skill | Renders `.pptx` + `.pdf`. |

## Steps

1. **Dispatch.** Run `python3 tools/gen_visual_asset.py --angle-id <id>`. Reads the row, validates `status = Drafted` and `draft_body` is non-empty, flips status to `Visualizing`, prints the format-specific `next_steps` JSON.

2. **Branch on format:**

   ### format = `image`
   - Pick the archetype from [references/lynx-brand.md](../references/lynx-brand.md) §8: `stat-slab` for hook posts and drop-stat posts, `before-after` for anonymized client outcomes, `industrial` for founder-mode and brand-pillar posts.
   - Read `image_size` from the dispatcher JSON (e.g. `1024x1536`). Use this exact value in two places below.
   - Invoke `linkedin-image-asset` skill with `output_mode = ai-prompt`. Then edit the output before saving:
     - **Strip the logo lines** — remove the "Shield logo bottom-right, 8% canvas height" line in the brief and the "Add shield logo bottom-right" line in the post-process block.
     - **Set the Dimensions line to the resolved `image_size`** instead of the skill's default 1200×1500.
     - **Make the prompt publish-ready.** In the PROMPT block, describe the exact text content (every word that should appear on the image), the font (Montserrat Bold for hero, Inter Regular for body), weight, color, size relative to canvas, and placement. The AI renders the text — there is no Canva overlay step.
     - **Trim the NEGATIVE PROMPT block.** Remove "text, letters, numbers, typography, words on image" — those are now required output. Keep aesthetic negatives only (blur, generic stock, gradients, drop shadows, fake screenshots, wrong colors, neon).
     - **Replace the POST-PROCESS block** with a single line noting "AI render is final, no overlay step."
   - Save the cleaned prompt to `temp/outputs/assets/<angle_id>/prompt.md`.
   - Run `python3 tools/gen_image_render.py --prompt-file temp/outputs/assets/<angle_id>/prompt.md --out temp/outputs/assets/<angle_id>/image.png --size <image_size>`. Use `--dry-run` first to verify the composed prompt before spending credits.
   - Open the PNG, verify: brand colors present (Lynx Green `#C6F21F` accent on Charcoal `#1C1C1C` base), no logo, no fabricated metrics, on-image text matches the brief, dimensions match the requested `image_size`.

   ### format = `carousel`
   - Invoke `linkedin-carousel-outline` skill → save to `temp/outputs/assets/<angle_id>/outline.md` (9 slides per the rhythm in brand reference §9).
   - Invoke `linkedin-carousel-design` skill → save to `temp/outputs/assets/<angle_id>/spec.md`. **Omit the logo line on every slide block.**
   - Invoke `linkedin-carousel-build` skill with `brand_assets_path` omitted and the "logo present on every slide" validation disabled. Outputs `carousel.pptx` and `carousel.pdf` to the same folder.
   - Verify: 9 slides, color rhythm holds (Charcoal hook → alternating Light Gray/Charcoal → one Lynx Green slab at slide 8 → Charcoal CTA), no two Light Gray slides in a row, no logo on any slide, fonts render, PDF < 10 MB.

   ### format = `poll`
   - Write the poll question and options. Rules (from this workflow's structure section): question forces a real choice, options are mutually exclusive and ICP-relevant, always include a comment-for-option-C engagement prompt that drives comments (which rank higher than poll votes).
   - Save question + options to temp files (avoids shell-escape pain), then:
     ```
     python3 tools/gen_poll_options.py \
         --angle-id <id> \
         --question-file /tmp/<id>-q.txt \
         --options-file /tmp/<id>-opts.txt \
         --comment-prompt-file /tmp/<id>-cp.txt
     ```

3. **Present at Gate 3.** Show the rendered asset (PNG / PDF / poll.md) in chat. The user reviews, asks for revisions, or approves.

4. **Mark Visual Ready.** After approval:
   ```
   python3 tools/sheets_mark_visual_ready.py \
       --angle-id <id> \
       --asset-path temp/outputs/assets/<id>/<image.png|carousel.pdf|poll.md>
   ```
   Flips `Visualizing → Visual Ready` and writes `asset_path` to col U.

## Carousel structure (default 9 slides)

Per [references/lynx-brand.md](../references/lynx-brand.md) §9. Logo placement instructions in that section do **not** apply for this project.

- Slide 1: Charcoal hook (same as post hook).
- Slide 2: Light Gray problem framing.
- Slides 3–7: Alternating Charcoal/Light Gray body. One idea per slide. Big number on 1–3 of these slides max.
- Slide 8: Lynx Green slab — recap.
- Slide 9: Charcoal CTA — "Comment <CTA_KEYWORD> and I'll send <asset>." No live link.

## Poll structure

- Question forces a real choice ("Which one wastes more spend on Amazon: bad keywords or bad creative?"), not a survey.
- 3–4 mutually-exclusive options. LinkedIn's max is 4.
- Always include the comment-for-option-C prompt that gets posted as the **first comment** under the poll. Comments rank higher than poll votes in the algorithm.

## Image archetypes

Per [references/lynx-brand.md](../references/lynx-brand.md) §8:

- **A. stat-slab** — hook posts, drop-stat posts. Charcoal background, giant Lynx Green numeral, one supporting line of white Inter Regular. **No logo.**
- **B. before-after** — anonymized client outcome posts. Two-panel split, dashed/red trend on Light Gray (left), solid Lynx Green up-and-to-the-right on Charcoal (right). Honest data only. **No logo.**
- **C. industrial** — founder-mode / brand-pillar posts. Real-world hero shot with Lynx Green accent in-frame, optional Charcoal slab in lower third with Lynx Green Montserrat headline overlay. **No logo.**

## Edge cases

- **Carousel topic doesn't have 9 distinct slide ideas** → cut to 5–7 slides rather than padding. The build skill validates the rhythm; if it can't honor the alternating rule with fewer slides, fall back to all-Charcoal with one Lynx Green slab.
- **Poll question turns into a survey** (everyone agrees) → regenerate with sharper, mutually-exclusive options.
- **OpenRouter render fails** → check `OPENROUTER_API_KEY` is set in `.env`. The error message names the missing var. For 429/5xx, `openrouter_client.generate_image` retries 3× with exponential backoff; if it still fails, switch to `output_mode = brief` and produce the image manually in Canva.
- **No image in response** → the model returned text only. Confirm the OpenRouter model actually supports image output. The error message prints the response message keys to help diagnose.
- **Sheet status is not `Drafted`** when running the dispatcher → likely Gate 2 wasn't actually approved, or the row has been re-run. Inspect the row before continuing. Re-runs are allowed when status is `Visualizing` or `Visual Ready`.
- **format = `video`** → not in scope. Either change the format or skip the angle.

## Output

- `temp/outputs/assets/<angle_id>/` — `prompt.md`, `image.png`, `outline.md`, `spec.md`, `carousel.pptx`, `carousel.pdf`, or `poll.md` (only the files relevant to the format).
- Sheet row updated: `status = Visual Ready`, `asset_path = temp/outputs/assets/<id>/<file>`.

## Hand-off
[06_content_calendar.md](06_content_calendar.md).
