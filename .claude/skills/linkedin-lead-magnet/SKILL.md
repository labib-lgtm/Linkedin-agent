---
name: linkedin-lead-magnet
description: Generate the deliverable PDF content (the "Y" in "Comment X and I'll send Y") for a LinkedIn post. Use when a Gate-2-approved post draft has a `cta_keyword` populated, which is essentially every Lynx Media post. Produces a structured markdown spec that `tools/gen_lead_magnet.py` renders to a brand-styled PDF. The PDF gets DM'd to commenters at T+3h per the engagement-loop sequence.
---

# linkedin-lead-magnet

Produces the actual deliverable a commenter receives when they type the CTA keyword on a post. Every Lynx Media post ends with "Comment X and I'll send Y" — this skill builds Y. Without it, the CTA is a hollow promise that breaks trust faster than not posting at all.

## When to invoke

- A post draft has cleared Gate 2 (status = `Drafted` on the angles tab) and `cta_keyword` is populated
- Workflow [05b_lead_magnet.md](../../../workflows/05b_lead_magnet.md) is running
- Direct ask: "build the lead magnet for [angle_id]"

## When NOT to invoke

- Before Gate 2 (the body and CTA may still change)
- For a post that has no `cta_keyword` (rare — flag this as a content problem upstream)
- For posts that promise a calendar booking only ("Reply CALL to book a 30-min audit"). Those route to a Calendly link, not a PDF.

## Inputs

| Field | Required | Description |
|---|---|---|
| `angle_id` | yes | E.g. `2026-W18-A08`. Used as folder name for output. |
| `cta_keyword` | yes | The single uppercase word the commenter will type. From the angles tab. |
| `draft_body` | yes | The full post body. The CTA promise lives in the last paragraph; the substance the deliverable expands on lives throughout. |
| `cta_promise` | yes | The exact words after "I'll send" in the post (e.g. "the pre-pause checklist. 8 questions to run before you cut a profitable-looking campaign, plus the 21-day measurement framework."). Parse this verbatim from the body. |

## Process

1. **Parse the promise.** Read the post's CTA line. Extract the structural commitments (e.g. A08 promises three deliverables: a checklist, 8 questions, a 21-day framework). Each commitment becomes a section of the PDF.

2. **Pull substance from the body.** The deliverable is not a summary of the post — it's the post's argument expanded into operator-grade tools. If the body says "if a campaign converts at 2x or more above category baseline AND you already rank 1 organically, the campaign is probably stealing from you," the deliverable turns that into a yes/no question with a specific threshold.

3. **Ground in winners memory.** Skim [temp/resources/winners_memory.md](../../../temp/resources/winners_memory.md) for related patterns. Pull anonymized client outcomes if any apply.

4. **Write the spec.** Output a structured markdown file with the sections below. Preserve operator-grade specifics — no generic best-practice fluff.

5. **Apply voice rules** (locked, see [feedback_humanized_writing.md](/Users/labib/.claude/projects/-Users-labib-Downloads-Everything-AI-Linkedin-Agent/memory/feedback_humanized_writing.md)):
   - No em-dashes (`—`). Use periods, commas, or "and."
   - No asterisks (`*`, `**`). Restructure for emphasis.
   - No hash (`#`) characters in the body of the deliverable. (Markdown headings inside this skill output are fine — the renderer parses them out.)
   - "How I" / "How we did it" beats "How to."

## Output structure

Save to `temp/outputs/assets/<angle_id>/lead_magnet.md`. The renderer in `tools/gen_lead_magnet.py` parses this format.

```markdown
# COVER

TITLE: [3-6 words, all-caps, the operator-grade name of the deliverable]
SUBTITLE: [single line, ≤ 14 words, what they're getting]
BYLINE: [one line of receipts — "From $29M of managed Amazon spend" or similar]

# WHY THIS MATTERS (page 2)

HEADLINE: [one strong sentence that frames the problem]
BODY:
[2-3 short paragraphs grounding the problem in real terms. Reference the post's anchor scenario without rehashing it word-for-word. End with the specific, measurable signal the deliverable helps detect.]

# [SECTION_NAME] (page 3+)

[A section per structural commitment in the CTA promise. Use one of these section types:]

CHECKLIST:
1. [Operator-grade yes/no question with specific threshold or metric]
2. ...

FRAMEWORK_TABLE:
| Period | Expected | What to do |
|---|---|---|
| Week 1 | [specific number] | [specific action] |
| Week 2 | ... | ... |

PRINCIPLE:
[A single bolded rule, then a paragraph explaining when it fires and when it doesn't.]

# CLOSING (last page)

PRINCIPLE_RECAP: [one-sentence restatement of the core idea]
INVITATION: [one specific reply prompt that filters for serious operators — e.g. "Reply to this DM if your branded campaigns convert above 25% and you already rank 1 organically. We will pull a free 20-minute teardown of one of your campaigns and tell you whether it's stealing or earning."]
SIGNATURE:
- Lynx Media
- $29M+ managed across 500+ Amazon stores
- lynxmedia.co
```

## Anti-patterns

- Generic best-practice content the reader could find anywhere ("optimize your ACoS," "track your CTR"). The post earns the comment by being specific. The deliverable has to clear the same bar.
- Padding to hit a page count. 1 page of substance beats 4 pages with filler. Aim for 3 pages, max 5.
- Live links to external resources that may move. The PDF must still make sense 3 weeks later when someone re-finds it in their downloads folder.
- A CTA in the deliverable that requires a click. The invitation should be a reply-to-DM prompt — no buttons, no links, no booking widgets in the PDF itself.
- Pushing the audit booking too hard. The deliverable earns the next conversation; it doesn't sell it.
- Restating the post. The reader already saw the post. The deliverable goes deeper.
- Made-up client metrics. Anonymize, never invent.

## Output discipline

| Page count | When |
|---|---|
| 3 pages | Default. Cover + 1-2 substance pages + closing. |
| 4-5 pages | Only if the CTA promised three or more distinct deliverables (e.g. checklist + questions + framework). |
| 6+ pages | Reject. Restructure for density. |

## References

- [references/lynx-brand.md](../../../references/lynx-brand.md) — color palette, type hierarchy, receipts (§1)
- [temp/resources/winners_memory.md](../../../temp/resources/winners_memory.md) — winning patterns to ground specifics in
- [workflows/05b_lead_magnet.md](../../../workflows/05b_lead_magnet.md) — the SOP that invokes this skill
- [tools/gen_lead_magnet.py](../../../tools/gen_lead_magnet.py) — the renderer that consumes this skill's output
