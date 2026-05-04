# LinkedIn Agent — Workflow Index & Locked Decisions

The 9 workflows below implement the LinkedIn content engine described in [temp/resources/linkedin-agent-brief.md](../temp/resources/linkedin-agent-brief.md). They chain into a weekly cycle but each is invocable on its own.

## Locked decisions (2026-05-03, updated after growth-plan share)

| Decision | Choice | Notes |
|---|---|---|
| **Source of truth** | [growth_plan.md](../temp/resources/growth_plan.md) (mirror of [Google Sheet](https://drive.google.com/file/d/1nWT1rMpxK_cVJDt5jMI0l78Fg1RYFAS1/view)) | Already-built 60-post / 12-week strategy. Workflows execute *against* it; don't reinvent. |
| Scheduler / publishing API | **Unipile API** | Overrides the doc's Taplio recommendation. Removes LinkedIn MDP gating; lets us publish + read DMs + monitor comments from the agent. |
| Client pattern data source | **Google Sheet** | Anonymized: vertical, ad spend, ACoS before/after, what worked, what failed. Still needed for posts beyond the 10 already drafted. |
| Post formats | **Text, image, carousel, poll, video** | Video reintroduced per doc (60s scripts written). |
| Creators tracked (8) | **Group A — Amazon peers:** Elizabeth Greene (Junglr), Destaney Wishon (BetterAMS), Brandon Young (Data Dive), Joe Shelerud (Ad Advance). **Group B — tactical pattern sources:** Brigitta Ruha, Travis Moh, Zsolt Kovacs, Vadim Soin. | A = topic/SOV competition. B = hook/format patterns to adapt. See [02_creator_tracker.md](02_creator_tracker.md). |
| Posting timezone | **US Eastern**, ~8:00 AM weekdays | Per doc's daily playbook. |
| Cadence | **5 posts/week** (Mon–Fri), **2-week planning window** | Quality > volume. Plan 10 posts, ship them, measure, then plan the next 10. Doc has 60 mapped out — we don't pre-commit beyond 2 weeks. |
| **Approval gate (GATE 1)** | **Google Sheet `angles` tab** (`LYNX_GROWTH_PLAN_SHEET_ID`) | Replaces verbal pick-3-4. Agent writes angles as `Pending`; user marks `Approved`/`Killed` in column B at their own pace. `04_post_writer` reads `status=Approved` rows. |

## Workflow chain

```
Sunday eve  → 01_niche_research → 02_creator_tracker → 03_topic_pipeline
              → sheets_push_angles → [GATE 1: user marks Approved in Sheet]
Monday AM   → 04_post_writer (reads Sheet) → 05_visual_asset → [GATE 2: edit + approve in chat]
            → 06_content_calendar → 07_publish (per slot) → sheets_mark_posted
Each post   → 08_engagement_loop (first 60 min)
Sunday AM   → 09_performance_review → sheets_write_metrics + memory update → feeds next week's 03
```

## Workflows

| # | File | Job |
|---|---|---|
| 01 | [01_niche_research.md](01_niche_research.md) | Pull weekly Amazon/DTC industry signal |
| 02 | [02_creator_tracker.md](02_creator_tracker.md) | Score the 4 tracked creators' recent posts |
| 03 | [03_topic_pipeline.md](03_topic_pipeline.md) | Synthesize 8–12 specific topic ideas |
| 04 | [04_post_writer.md](04_post_writer.md) | Draft post (wraps existing `linkedin-growth` skill) |
| 05 | [05_visual_asset.md](05_visual_asset.md) | Carousel spec / image brief / poll options |
| 06 | [06_content_calendar.md](06_content_calendar.md) | Slot drafts into the week, enforce format diversity |
| 07 | [07_publish.md](07_publish.md) | Push to LinkedIn via Unipile |
| 08 | [08_engagement_loop.md](08_engagement_loop.md) | First-60-min protocol + 1+3 commenting |
| 09 | [09_performance_review.md](09_performance_review.md) | Weekly retro + memory update |

## Shared infrastructure (do not duplicate)

- Writing playbook → existing `linkedin-growth` skill (SLAY, hooks, 4-3-2-1)
- Voice enforcement → existing `brand-voice` plugin
- Memory → `productivity:memory-management`
- Web research → `WebSearch`, `WebFetch`, `enterprise-search`
