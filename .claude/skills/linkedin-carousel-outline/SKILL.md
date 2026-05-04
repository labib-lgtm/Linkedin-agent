---
name: linkedin-carousel-outline
description: Turn an approved LinkedIn post topic into a 9-slide content outline (copy and structure only, no visual decisions). Use when the user has a topic slotted as a carousel format, asks "outline a carousel about X" / "give me the slide-by-slide for X," or after `linkedin-post-writer` produces a draft tagged for carousel format. Do NOT use for text-only / video / single-image posts, decks > 12 slides, or topics not yet approved at Gate 1.
---

# linkedin-carousel-outline

Turns an approved post topic into a slide-by-slide content outline for a 9-slide LinkedIn carousel. Copy and structure only. No visual decisions — those happen in `linkedin-carousel-design`.

## When to invoke

- User has an approved post topic slotted as a carousel
- Direct ask: "outline a carousel about [topic]," "give me the slide-by-slide for [post]"
- Workflow chain: called automatically after `linkedin-post-writer` produces a carousel-tagged draft

## When NOT to invoke

- Text-only, video, or single-image posts
- Decks longer than 12 slides (LinkedIn document carousel sweet spot is 7–10)
- Before a topic has been approved through Gate 1 in [03_topic_pipeline.md](../../../workflows/03_topic_pipeline.md)

## Inputs

| Field | Required | Description |
|---|---|---|
| `topic` | yes | The approved post topic + the angle/POV |
| `pillar` | yes | One of: PPC Operator / Conversion Lab / Agency Founder |
| `data_points` | yes | 2–5 specific stats, client outcomes, or proof points |
| `audience` | no | Default = 7–8 figure Amazon sellers + DTC operators |
| `slide_count` | no | Default = 9. Allow 7–12 |
| `framework_name` | no | A named framework to introduce (e.g. "The 3-Lever TACoS Audit") |

## Process

1. **Load brand reference.** Read [references/lynx-brand.md](../../../references/lynx-brand.md) §5 (voice) and §6 (pillars). Don't apply visuals — just absorb the voice anchors.
2. **Run topic through SMPV** (Skill / Market / Problem / Value) using the existing `linkedin-growth` skill to confirm there's a defensible angle. If not, stop and tell the user to refine.
3. **Write Slide 1 (hook) first.** Use one of these patterns:
   - **Specific number + outcome** — "$29M managed. The 3 mistakes that killed ROAS most often."
   - **Reader-state** — "If your TACoS is creeping above 15%, read this."
   - **Uncomfortable claim** — "Most Amazon PPC advice is wrong. Here's what actually works."
   - **Promise + timeline** — "How we cut a brand's TACoS from 22% to 8% in 6 weeks."
4. **Write Slide 2 (problem framing).** Anchor in the reader's specific situation — second person, no "many sellers struggle with…" generic openers.
5. **Plan the body slides (3–7) before writing them.** Pick ONE structure:
   - List (3 specific things)
   - Framework (3-step process)
   - Teardown (before/after analysis)
   - Contrarian breakdown (5 myths + reality)
   Stick with it. Don't mix.
6. **Write each body slide** with one idea per slide. If a slide has two ideas, split it. Each body slide gets one stat or callout — that's what becomes the giant Lynx Green numeral in the design step.
7. **Write Slide 8 (recap).** Name the framework if there is one. This is the slide people screenshot.
8. **Write Slide 9 (CTA).** Use the comment-CTA pattern from `linkedin-growth` — "Comment 'TACoS' and I'll send the audit template." Never put a live link in the slide itself; LinkedIn's algorithm penalizes link-in-post. Links go in the first comment.
9. **Run a Lynx voice pass.** Strip filler. Every claim has a number or specificity. No "happy to share." No "in this carousel we'll explore."

## Output format

Write to `temp/outputs/carousels/<YYYY-MM-DD>-<topic-slug>-outline.md`:

```
# Carousel outline — [topic]

Slide 1 — Hook
  Headline: [≤ 8 words, all-caps in final design]
  Subhead: [one line, frames the stakes]
  Pillar: [PPC Operator | Conversion Lab | Agency Founder]

Slide 2 — Problem framing
  Headline: [reader-state]
  Body: [3–5 lines, second person — "you"]

Slides 3–7 — Body
  [one specific insight, framework step, or data point per slide]
  [each slide: headline + body copy ≤ 35 words + the one stat or callout]

Slide 8 — Recap / payoff
  Headline: [the framework name or the takeaway in 5–8 words]
  Body: [3-line summary of the body slides]

Slide 9 — CTA
  Headline: [reader-facing question]
  Body: [the comment-CTA — "Comment X and I'll send Y"]
  No external link in this slide. Link goes in the first comment.
```

## Anti-patterns (kill on sight)

- Generic listicles ("5 tips for Amazon PPC") with no POV
- Slides ChatGPT could write for any agency
- "How to" structure instead of "How I" / "How we did it"
- Multiple ideas crammed onto one slide
- A CTA that says "DM me" without a clear reason to
- An external URL on Slide 9
- Slides that introduce a framework without naming it
- Hook slide without a $/€/£ amount or a specific number (winners pattern P1 — see [winners_memory.md](../../../temp/resources/winners_memory.md))

## Handoff

Output goes to `linkedin-carousel-design` next. That skill receives the outline and applies the Lynx visual system slide-by-slide.

## References

- [references/lynx-brand.md](../../../references/lynx-brand.md) §5 (voice), §6 (pillars)
- [temp/resources/winners_memory.md](../../../temp/resources/winners_memory.md) — winning hook patterns from Labib's actual top posts
- `linkedin-growth` skill (existing) — SLAY framework, hooks, 4-3-2-1 structure
