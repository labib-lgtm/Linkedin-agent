# 04 — Post Writer

## Objective
Draft one LinkedIn post for an approved topic. **Wraps** the existing `linkedin-growth` skill — does NOT duplicate the writing rules.

## When to run
Whenever there are `Approved` angles in the Sheet's `angles` tab. Run 3–4× per week to draft each one.

## Inputs
- Pulled from the Sheet by `sheets_read_approved.py`: `angle_id`, `pillar`, `format`, `hook_draft`, `cta_keyword`, `winner_patterns`, `gap_filled`, `notes`, `source_md`
- Optional: anonymized client data referenced by the angle

## Tools / skills used
- **Existing `linkedin-growth` skill** — the writing playbook (SLAY, SMPV, What/Who/How, 4-3-2-1, hook rules). Always invoke this for the actual writing.
- **Existing `brand-voice` plugin** — voice rules. Run UPSTREAM (in system prompt at draft time) AND as a final check.
- `tools/sheets_read_approved.py` — pulls the next batch of Approved angles, atomically flips them to `Drafting` so re-runs are idempotent
- `tools/draft_context.py` — gathers winners memory + topical past wins + voice anchors + killed topics into a single bundle the writer reads before drafting
- `tools/draft_critic.py` — grades the draft against P1–P6 winning patterns; returns JSON. Verdicts: `ship-ready` / `revise-once` / `rewrite`. The writer must hit `ship-ready` or `revise-once` before output.
- `tools/sheets_mark_drafted.py` — flips `Drafting → Drafted` once the draft is on disk

## Hook rules (enforce, don't re-derive)
- First line ≤49 chars.
- Whole hook readable above the "see more" fold (~3 lines).
- Specific number + outcome > vague claim.
- "How I…" > "How to…".
- Reader-state hook ok ("If your TACoS is creeping above 15%, read this.").

## Voice anchors (kill on sight)
- "Happy to announce", "humbled and honored", "thrilled to share"
- Anything that could appear in any other Amazon agency post — cut it.
- ChatGPT-isms (em-dashes everywhere, "in today's fast-paced world", tricolons of empty adjectives).

## Steps
0. **Bank check.** Run `python tools/sheets_read_approved.py --count-pending`. If `approved_unwritten == 0`: tell the user "no approved angles — open the Sheet and approve some" and stop. If `pending <= 2` AND `approved_unwritten <= 1`: prompt "angle bank running low, want me to run 03 to generate more?" before proceeding.
1. **Pull batch.** Run `python tools/sheets_read_approved.py --limit 1` → JSON for the next approved angle. Status flips to `Drafting` atomically.
2. **Gather context (Improvement 3).** Run `python tools/draft_context.py --angle-id <id>` → writes `temp/outputs/drafts/<id>-context.md`. Bundle includes: angle row + winners memory (P1–P6) + top 3 topically-closest historical winners + brand voice anchors + killed topics. **The writer reads the bundle. It is the source of truth for this draft. Don't write a generic Amazon-PPC post — write THIS post grounded in the patterns and proof in the bundle.**
3. **Generate 3 hook variants (Improvement 1).** Each targets a different winning pattern:
   - **Hook A** — "specific number + outcome" (W1, W3 style)
   - **Hook B** — "two-line contradiction" (W2, W4 style)
   - **Hook C** — "reader-state question" or "uncomfortable claim"
4. **Draft the body** invoking `linkedin-growth` (≤2,000 chars · single idea per paragraph · story arc · brand voice rules in the system prompt, NOT as a final pass — Improvement 4). End with the lead-magnet CTA: "Comment <CTA_KEYWORD> and I'll send <asset>." No live link.
5. **Self-critique pass (Improvement 2).** Pipe the candidate body into `python tools/draft_critic.py --text "<body>" --cta-keyword <KW>` → JSON. If verdict is `rewrite`: revise once and re-grade. If still `rewrite`: surface the failed patterns to the user before writing to Sheet. If `ship-ready` or `revise-once`: proceed.
6. **Write the draft INTO the Sheet.** This is the canonical store — no markdown files. Save the body to a temp file (avoids shell-escaping pain on long content), then:
   ```
   python tools/sheets_mark_drafted.py \
       --angle-id <id> \
       --hook-chosen <A|B|C> \
       --hook-alternates-file /tmp/<id>-alts.txt \
       --body-file /tmp/<id>-body.txt \
       --critic-score "<score>" \
       --slide-outline-file /tmp/<id>-slides.txt   # carousel/video only
   ```
   Tool flips status to `Drafted`, writes hook variants + body + critic score + slide outline into cols O–S.
7. **Present in chat** by reading the Sheet row back: `python tools/sheets_read_draft.py --angle-id <id>`. Surface the 3 hook variants + body + score in chat for **Approval Gate 2**. Edits during Gate 2 happen in the Sheet cell directly (the user types in column Q), not in a file. Round-trip: agent re-reads after every edit.

## Output
- Sheet row updated: `status=Drafted`, `hook_chosen`, `hook_alternates`, `draft_body`, `critic_score`, `slide_outline` (carousel only) all populated
- The `temp/outputs/drafts/<id>-context.md` bundle from step 2 stays as an audit artifact (not the draft itself)
- No more `<slug>.md` draft files — Sheet is canonical

## Edge cases
- Topic doesn't fit any pillar cleanly → kick back to 03 and mark the angle `Killed` in the Sheet (then run `sheets_log_killed.py`).
- Writer can't produce a non-generic hook → flag explicitly, ask Labib for the angle rather than invent. Don't flip the row status until human input.
- `sheets_read_approved.py` returns 0 angles unexpectedly (after the bank check passed) → likely a race; safe to retry. If it's still empty, something flipped the status mid-run — investigate before re-pushing.
- Body > 3,000 chars → `sheets_mark_drafted.py` warns to stderr but still writes. LinkedIn truncates at 3K; revise body before publish.

## Hand-off
- If format is text-only → straight to [06_content_calendar.md](06_content_calendar.md).
- If format needs visual → [05_visual_asset.md](05_visual_asset.md).
