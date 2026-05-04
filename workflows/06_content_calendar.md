# 06 — Content Calendar

## Objective
Slot the week's approved drafts into specific timestamps, enforce format diversity, and respect the 70-20-10 mix.

## When to run
Once per week, after Gate 2 (drafts + assets approved).

## Inputs
- All approved drafts in `temp/outputs/drafts/YYYY-WW/` with status `approved`
- Their associated assets in `temp/outputs/assets/YYYY-WW/`
- Last week's calendar (to avoid repeating the same format on the same weekday)

## Tools
- `tools/slot_posts.py` — applies the rules below and writes the schedule

## Rules
- **Cadence:** **5 posts/week** (Mon–Fri). Per [growth_plan.md](../temp/resources/growth_plan.md).
- **Planning window:** **2 weeks at a time (10 posts)**. Plan, ship, measure, then plan the next 10. Don't pre-commit further — the doc has 60 mapped out but we burn-rate 10 at a time to keep quality high and stay responsive to performance signals.
- **Default slots (US Eastern):** all posts go out at **~8:00 AM ET** (per doc's daily playbook). Pre-scheduled the night before.
- **Format diversity:** no two consecutive posts of the same format. Across each 2-week window aim for: ~3 text/text+image, ~3 carousel, ~2 video, ~2 image (lead gen). Adjust based on what wins.
- **Pillar mix per rolling 2 weeks:** ~60% educational/tactical, ~20% case study, ~10% personal/founder, ~10% lead gen with CTA.
- **No external links in the post body.** Use first-comment for links (handled by [07_publish.md](07_publish.md)).
- **CTA discipline:** every lead-gen post uses the doc's CTA Engine keywords (AUDIT, STRUCTURE, BUDGET, etc.). Auto-DM responder set up in Unipile to send the resource when the keyword is commented.

## Steps
1. Load approved drafts.
2. Apply slot rules; produce a schedule.
3. If conflicts (e.g., two carousels approved) → ask Labib which gets pushed to next week.
4. Write the schedule.

## Output
`temp/outputs/calendar/YYYY-WW.md` — table of timestamp + draft slug + asset path + first-comment text (if any).

## Edge cases
- Fewer than 3 approved drafts → publish what's approved, leave gaps; flag in [09_performance_review.md](09_performance_review.md).
- More than 4 approved drafts → roll the extras to next week (don't burn goodwill posting 5×/week).

## Hand-off
[07_publish.md](07_publish.md) reads this file at each scheduled time.
