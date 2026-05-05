# 05b — Lead Magnet

## Objective
Produce the deliverable PDF behind every post's CTA — the "Y" in "Comment X and I'll send Y." Without this asset, every CTA is a hollow promise. The PDF is what gets DM'd to commenters at T+3h per the engagement-loop sequence.

## When to run
**After Gate 2 approval** of the draft from [04_post_writer.md](04_post_writer.md), in **parallel** with [05_visual_asset.md](05_visual_asset.md). Runs whenever the angle row has a `cta_keyword` populated, which is essentially every Lynx post.

The trigger is explicit: agent runs both 05 (visual) and 05b (lead magnet) before scheduling. They're independent — neither blocks the other.

## Engagement sequence (the post-publish flow this asset feeds)

Per locked direction (2026-05-04), the lead magnet is **not** sent instantly. It's part of a 3-hour delayed, two-touch public-comment sequence run by [08_engagement_loop.md](08_engagement_loop.md):

| When | Action | Surface |
|---|---|---|
| T+0 (commenter types CTA keyword) | Reply on the comment: "Sharing soon, sit tight." | Public comment thread |
| T+3h | DM the commenter the lead-magnet link | Private DM |
| T+3h (immediately after the DM) | Reply on the comment again: "Just sent it to your DMs." | Public comment thread |

The two-touch public sequence keeps engagement on the post alive past the first-hour reach window and reads less salesy than instant DM. The asset has to **survive a 3-hour gap and read well 3 weeks later** when someone re-finds it in their downloads folder.

(Phase B builds the timing + dispatch + recipient log. Phase A — this workflow — only ensures the asset exists.)

## Inputs
- Approved post draft (status = `Drafted` in the `angles` table)
- `cta_keyword` from the angle record (e.g. `KILL`, `PRIME`)
- The exact CTA promise from the post body (the words after "I'll send")

## Tools / skills used
- **`linkedin-lead-magnet` skill** — writes the structured markdown for the deliverable. Voice rules locked: no em-dashes, no asterisks, no hashtags. Operator-grade specifics, not generic best-practice fluff.
- [tools/gen_lead_magnet.py](../tools/gen_lead_magnet.py) — Pillow-based PDF renderer. Reads a JSON spec (`lead_magnet_spec.json`), produces page PNGs + combined `lead_magnet.pdf`. Letter portrait by default (1275×1650 px @ ~150 DPI).
- [tools/sheets_mark_lead_magnet_ready.py](../tools/sheets_mark_lead_magnet_ready.py) — writes the relative path + URL to the angle's `lead_magnet_path` / `lead_magnet_url` fields. Does NOT change `status`. (Filename keeps the `sheets_*` prefix for backwards compatibility; the implementation now writes to Supabase.)

## Steps

1. **Read the angle record.** The agent already has the draft body and `cta_keyword` from 04's output, or pulls fresh from Supabase via [tools/sheets_read_draft.py](../tools/sheets_read_draft.py).

2. **Invoke `linkedin-lead-magnet` skill** with `angle_id`, `cta_keyword`, `draft_body`, and the parsed `cta_promise` (verbatim text after "I'll send" in the post). The skill produces `temp/outputs/assets/<angle_id>/lead_magnet.md` with sections: COVER, WHY THIS MATTERS, the substance sections (CHECKLIST / FRAMEWORK_TABLE / PRINCIPLE), CLOSING.

3. **Translate `lead_magnet.md` → `lead_magnet_spec.json`.** The renderer reads JSON. The agent maps each markdown section to a page block with explicit positioned elements. Use the brand spec for type sizes:
   - Cover hero (Lynx Green Montserrat Bold): 96–120pt
   - Page headline (Charcoal Montserrat SemiBold): 56–72pt
   - Body copy (Inter Regular/Medium): 32–40pt
   - Numerals on lists (Lynx Green Montserrat Bold): match body or +20%

4. **Render the PDF.**
   ```
   python3 tools/gen_lead_magnet.py \
       --spec-file temp/outputs/assets/<angle_id>/lead_magnet_spec.json
   ```
   Outputs `lead_magnet_p01.png` ... `lead_magnet_pNN.png` plus combined `lead_magnet.pdf`.

5. **Present at Gate 3b.** Show the PDF in chat alongside (or after) the visual asset from 05. The user reviews against the post's CTA promise: does the deliverable match what was promised?

6. **Upload to Google Drive.** After Gate 3b approval:
   ```
   python3 tools/drive_upload_lead_magnet.py --angle-id <id>
   ```
   Uploads `lead_magnet.pdf` to a Drive folder (`lynx-lead-magnets` by default), sets sharing to "Anyone with link can view", returns the `webViewLink`, and writes the URL to the angle's `lead_magnet_url` field via `sheets_mark_lead_magnet_ready.py --lead-magnet-url ...`.

   This URL is what the Trigger.dev engagement-loop task DMs to commenters at T+3h. It must be public-readable since LinkedIn DM recipients aren't in any single org.

7. **Mark local path too** (audit trail, optional):
   ```
   python3 tools/sheets_mark_lead_magnet_ready.py \
       --angle-id <id> \
       --lead-magnet-path temp/outputs/assets/<id>/lead_magnet.pdf
   ```
   Writes the relative path to column W. Status stays at whatever 05's mark step set (`Visual Ready` or unchanged).

## Quality bar (for Gate 3b review)

- **Promise match**: every commitment in the post's CTA line is a section of the PDF. No more, no less.
- **Operator-grade specifics**: no "optimize your ACoS" / "track your CTR." Every guideline has a number, a threshold, or a measurable signal.
- **Stands alone**: the reader doesn't need the post in front of them. The PDF makes sense cold.
- **Voice clean**: zero em-dashes, zero asterisks for emphasis, zero hashtag dumps. Reads like Labib wrote it, not a generic AI.
- **No live links**: every URL embedded in the PDF must still work 3 weeks from now. If in doubt, omit. The closing CTA should be a reply-to-DM prompt, not a click target.
- **Page count**: 3 pages default; up to 5 if the CTA promised three or more deliverables; 6+ pages reject and restructure.

## Output
- `temp/outputs/assets/<angle_id>/lead_magnet.md` — skill output, human-readable source
- `temp/outputs/assets/<angle_id>/lead_magnet_spec.json` — render spec
- `temp/outputs/assets/<angle_id>/lead_magnet_p01.png` ... — page PNGs
- `temp/outputs/assets/<angle_id>/lead_magnet.pdf` — combined PDF
- Sheet column W updated with relative path

## Edge cases
- **Post has no `cta_keyword`** — flag back to 03 / 04 as a content problem. Every Lynx post should have one. Don't render an empty deliverable.
- **CTA promise is vague** ("I'll share more") — push back upstream. The deliverable can't be specific if the promise isn't.
- **PDF > 5 pages** — restructure for density. The whole asset should be readable in 60–90 seconds.
- **Post is a poll or text-only with no asset promise** — skip 05b entirely. Some formats won't have a CTA keyword.

## Hand-off
- Phase A ends after Sheet column W is written
- Phase B (separate workflow, separate session) picks up: Drive upload, DUB short-link, then [08_engagement_loop.md](08_engagement_loop.md) wires the T+0/T+3h sequence
