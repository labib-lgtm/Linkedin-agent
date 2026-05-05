# 03 — Topic Pipeline

## Objective
Synthesize this week's research + creator signals + Labib's own past winners + Lynx client pattern data into 8–12 *specific* topic ideas. Each idea has a hook, a pillar, and a suggested format. **Approval Gate 1** lives in the canonical store: `sheets_push_angles.py` writes ideas as `Pending`; Labib marks `Approved`/`Killed` in the webapp at his own pace.

## When to run
Sunday evening, after [01_niche_research.md](01_niche_research.md) and [02_creator_tracker.md](02_creator_tracker.md).

## Inputs
- `temp/outputs/research/YYYY-WW.md` — niche research brief
- `temp/outputs/creators/YYYY-WW.md` — competitor signals
- `temp/resources/winners_memory.md` — past Labib posts that performed (updated by [09_performance_review.md](09_performance_review.md))
- Supabase `killed_topics` table — angles Labib previously marked `Killed` (read via `supabase_client.read_table('killed_topics')`); don't re-suggest
- Supabase `angles` table `Pending` records — these ARE the backlog; consider leftover Pending angles before generating new ones

## Tools
- `tools/synthesize_topics.py` — combines inputs, prompts a model to draft topic ideas, writes them to `temp/outputs/topics/YYYY-WW.md`
- `tools/sheets_push_angles.py` — pushes the markdown angles into the `angles` table as `Pending` (filename keeps `sheets_*` prefix; implementation now writes to Supabase)
- `tools/read_winners_memory.py` — formats past winners for the prompt context

## Three content pillars (every idea must fit one)
1. **The PPC Operator** — tactical Amazon ads. Bid strategy, ACoS/TACoS, DSP, Q4 prep. (~70%)
2. **The Conversion Lab** — A+ content, listings, A/B teardowns. (Carousel-friendly.)
3. **The Agency Founder** — building Lynx, hiring, client expectations, Canadian-founder POV. (~20–30%)

## Steps
1. Load all input sources. Read `killed_topics` table + existing `Pending` angles from Supabase so we don't regenerate ideas already on the table.
2. Generate 8–12 ideas. Each must include: hook (≤49 chars first line), pillar tag, format suggestion (text/carousel/image/poll), why-it-works (1 sentence), and which input source it draws from.
3. Drop any idea that overlaps a record in the `killed_topics` table.
4. Drop any idea that's a generic listicle without a specific number, named scenario, or anonymized client outcome.
5. Save the ranked markdown to `temp/outputs/topics/YYYY-WW.md` (this stays as the human-readable archive).
6. Push the markdown to Supabase: `python tools/sheets_push_angles.py --source temp/outputs/topics/YYYY-WW.md --week YYYY-WW`. Surface a one-line summary in chat: "Pushed N angles, M skipped as duplicates. Open the webapp at /."

## Output
- Persisted markdown: `temp/outputs/topics/YYYY-WW.md` (full ranked list, archive copy)
- Live state: `angles` table — N records inserted with `status=Pending`
- Chat: a single summary line + webapp link. No more "let me show you the ranked list and you pick" — Labib approves at his own pace in the webapp.

## Edge cases
- Fewer than 8 viable ideas → say so out loud, ask whether to broaden inputs or run with what we have.
- Labib kills all suggestions → after a week with `Killed` records piling up, re-read `killed_topics` and ask "what kind of angle do you want instead?" before regenerating.
- Supabase is down → the markdown is still saved. Re-run `sheets_push_angles.py` later. No data lost.

## Hand-off
[04_post_writer.md](04_post_writer.md) reads `Approved` records from Supabase — this workflow no longer hands off topics directly; the `angles` table is the queue.
