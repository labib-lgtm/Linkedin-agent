# 09 — Performance Review

## Objective
Weekly retro on the past 7 days of posts. Identify winners, losers, and patterns. Write findings into a memory file that next week's [03_topic_pipeline.md](03_topic_pipeline.md) reads — **this is what makes the agent get better over time**.

## When to run
Sunday morning, before [01_niche_research.md](01_niche_research.md) kicks off the next week's cycle.

## Inputs
- All entries in `temp/outputs/published/YYYY-WW.md` for the past 7 days
- Engagement logs from [08_engagement_loop.md](08_engagement_loop.md)
- Unipile creds for pulling fresh metrics

## Tools
- `tools/unipile_get_my_posts.py` — refreshes `temp/resources/my_posts_raw.json` with the latest counters per post
- `tools/score_my_posts.py` — scores reactions/comments/reposts and emits `temp/outputs/post_winners_*.md`
- `tools/sheets_write_metrics.py` — appends metrics rows to the Sheet's `metrics` tab (one row per pull → time series)
- `tools/update_winners_memory.py` — appends a structured row to `temp/resources/winners_memory.md` (the prompt-context file)
- Optional: `data:create-viz` for a weekly chart

## Metrics that matter (in this order)
1. **Saves + Sends** — strongest 2026 ranking signal.
2. **Dwell time / impressions ratio** (when available).
3. **Comments** — especially comments from new accounts (top-of-funnel signal).
4. **Reposts** — distribution multiplier.
5. **Likes** — vanity, but useful as a baseline.

## Steps
1. Pull metrics for each post from the past 7 days via `unipile_get_my_posts.py` + `score_my_posts.py`.
2. Compare each post to the rolling 30-day median (winner = top 25%, loser = bottom 25%).
3. For winners, extract: hook pattern, format, pillar, topic, what made it specific.
4. For losers, extract: what was generic, what hook fell flat, was the topic stale.
5. Write a 1-page memo: this week's winners, losers, 1–3 hypotheses to test next week.
6. Append structured rows to `temp/resources/winners_memory.md` so [03_topic_pipeline.md](03_topic_pipeline.md) can use them.
7. **Sheet write-back.** Run `python tools/sheets_write_metrics.py --from-published YYYY-WW` → appends a row to the Sheet's `metrics` tab for every Posted angle from the week. This builds the long-form historical record (one row per metric pull, time series).
8. For any angle that is clearly stale or disproven by metrics, mark it `Killed` in the Sheet (or use `tools/sheets_log_killed.py --angle-id <id> --reason <text>` to also propagate it to the dedupe table).

## Output
- `temp/outputs/retros/YYYY-WW.md` — the memo
- `temp/resources/winners_memory.md` — append-only structured log (small + fast for the 03 prompt)
- Sheet `metrics` tab — long-form historical record (browse, pivot, chart over time)
- Two-tier on purpose: prompts read local files for speed; humans read the Sheet for browsing.

## Edge cases
- New account / not enough data for medians → use absolute thresholds for first 4 weeks (e.g., >2,500 impressions = winner), then switch to medians.
- A post went viral (>10× median) → flag as outlier, don't let it skew next week's prompt.

## Hand-off
`winners_memory.md` is read by [03_topic_pipeline.md](03_topic_pipeline.md) the next time it runs.
