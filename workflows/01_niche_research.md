# 01 — Niche Research

## Objective
Pull this week's signal from the Amazon advertising / DTC / ecommerce niche so the topic pipeline has fresh input.

## When to run
Sunday evening, weekly. Or ad-hoc when something newsworthy breaks (Amazon policy change, algo update, big seller news).

## Inputs
- Niche keywords: `amazon ads`, `amazon ppc`, `tacos`, `acos`, `amazon dsp`, `a+ content`, `amazon seller central`, `dtc on amazon`
- Source list (see Tools section below)
- Current ISO week (`YYYY-WW`)

## Tools
- `tools/fetch_rss.py` — pull RSS feeds (TBD: list of feeds)
- `tools/fetch_amazon_news.py` — Marketplace Pulse, Amazon Seller Central announcements (TBD)
- `WebSearch` / `WebFetch` for ad-hoc news
- Optional: `enterprise-search` if relevant MCPs are connected

## Sources to poll
- Marketplace Pulse
- Amazon Seller Central News & Announcements
- Helium 10 blog
- Jungle Scout blog
- /r/AmazonSeller, /r/PPC (top weekly threads)
- Conference recaps (Prosper, Amazon Accelerate, etc.) when in season

## Steps
1. Fetch all sources for the past 7 days.
2. Dedupe and filter to items relevant to the keywords above.
3. Group by theme (algo/policy / tactics / case study / industry news).
4. Write a 1–2 page markdown brief: top 5 stories with one-line "so what for content" notes.

## Output
`temp/outputs/research/YYYY-WW.md`

## Edge cases
- Nothing newsworthy this week → still produce a brief, mark "low signal week — lean on creator-tracker output for topics".
- Source down / rate-limited → log it, continue with the remaining sources, note the gap in the brief.

## Hand-off
Output is consumed by [03_topic_pipeline.md](03_topic_pipeline.md).
