# 02 — Creator Tracker

## Objective
Pull the last 7 days of posts from 4 tracked creators, score by engagement, extract topic + format patterns. Goal: learn what's getting traction in the niche so we can post sharper takes on similar topics — never copy.

## When to run
Sunday evening, weekly. Right after [01_niche_research.md](01_niche_research.md).

## Inputs
Tracked creators are split into **two groups with different jobs**. The full 8 are mirrored in [growth_plan.md](../temp/resources/growth_plan.md).

### Group A — Amazon-niche peers (topic + SOV competition)
What we extract: topics they're covering, what's getting traction *in our niche*, gaps we can own.
1. **Elizabeth Greene** (Junglr) — direct PPC agency competitor
2. **Destaney Wishon** (BetterAMS) — closest analog to Labib's positioning
3. **Brandon Young** (Data Dive) — 8-fig seller perspective; what *clients* engage with
4. **Joe Shelerud** (Ad Advance) — DSP-heavy content

### Group B — Tactical pattern sources (hook + format patterns to adapt)
What we extract: hook formulas, post structures, CTA patterns. **Not topics** — their niches are adjacent or different. Don't post about their niches; steal their structure.
5. **Vadim Soin** (PPC Jumpstart) — Amazon PPC for CPG; cheat-sheet / glossary format master
6. **Brigitta Ruha** (Growth Today) — B2B GTM; tool-roundup + tiered-framework master
7. **Travis Moh** (AdPush Media) — Meta ads for coaches; contrarian-hook formula ("Everyone says X…")
8. **Zsolt Kovacs** (oartconsult) — Microsoft Copilot; "invisible problem" naming pattern

- Their LinkedIn profile URLs: collect during Unipile setup
- Lookback window: 7 days

## Tools
- `tools/scrape_creator_posts.py` — pulls posts via Unipile API
- `tools/score_engagement.py` — normalizes engagement (likes + 5×comments + 3×reposts) divided by impressions when available; otherwise raw counts vs. that creator's 30-day median
- Unipile auth: see `.env` (`UNIPILE_API_KEY`, `UNIPILE_DSN`, `UNIPILE_LINKEDIN_ACCOUNT_ID`)

## Steps
1. For each creator, fetch posts from the last 7 days via Unipile.
2. Score each post (above-average vs. that creator's own baseline, not absolute).
3. For above-baseline posts, extract: topic, hook pattern, format (text/carousel/image/poll/video), opening line, CTA structure.
4. **Group A output:** ranked list of "Amazon topics getting traction this week" + flag any topic 2+ peers hit (high-signal — we should have a sharper POV ready).
5. **Group B output:** ranked list of "hook + format patterns that worked this week" — abstract these into reusable templates we can apply to *Amazon* topics.

## Output
`temp/outputs/creators/YYYY-WW.md` — ranked topics with example posts and engagement deltas.

## Edge cases
- Unipile rate limit → backoff and retry, then continue with what we have.
- A creator posted nothing this week → note it, skip.
- All 4 creators had a quiet week → still output the file, mark "low signal" so 03 leans more on niche research.

## Hand-off
Output is consumed by [03_topic_pipeline.md](03_topic_pipeline.md).
