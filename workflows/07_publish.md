# 07 — Publish

## Objective
Push a scheduled post (and any visual asset + first-comment) to LinkedIn at its slotted time via the Unipile API.

## When to run
At each scheduled timestamp from [06_content_calendar.md](06_content_calendar.md). Triggered by cron / scheduled task / manual run.

## Inputs
- A row from `temp/outputs/calendar/YYYY-WW.md` (timestamp, draft path, asset path, first-comment text)
- Unipile credentials in `.env`:
  - `UNIPILE_API_KEY`
  - `UNIPILE_DSN`
  - `UNIPILE_LINKEDIN_ACCOUNT_ID` (Labib's connected LinkedIn account)

## Tools
- `tools/sheets_read_draft.py` — pulls the `draft_body` (and metadata) from the Sheet for the given `angle_id`
- `tools/unipile_publish.py` — POSTs the post + media to Unipile's LinkedIn endpoint, then posts the first-comment if present
- `tools/sheets_mark_posted.py` — flips the Sheet row to `Posted`, stamps `date_posted` + `post_url`
- Unipile API ref: `https://docs.unipile.com/` (TBD: lock the exact endpoints during build)

## Steps
1. Read the scheduled item (carries the `angle_id`).
2. **Read the body from the Sheet** (canonical source — there is no local body file): `python tools/sheets_read_draft.py --angle-id <id>` → JSON. Fail loud if `draft_body` is empty (something is wrong; don't publish a stub).
3. Load any media file (image / carousel deck) from `temp/outputs/assets/` or wherever 05_visual_asset wrote it.
4. **Manual mode** (default for first 4 weeks): print the final post + asset preview in chat and ask Labib for go/no-go before calling Unipile.
5. **Auto mode** (only after 4 weeks of trust): publish without confirmation.
6. Call Unipile to publish, passing the `draft_body` text.
7. If a first-comment is set (often holds the lead-magnet link), wait ~10 seconds and post the first comment from the same account.
8. Capture the returned post URL.
9. **Local-first persistence of the publish RECORD.** Immediately append to `temp/outputs/published/YYYY-WW.md`: timestamp, `angle_id`, post URL. Body is NOT duplicated here (it lives in the Sheet); this is just the audit trail of what shipped when.
10. **Sync to Sheet.** Run `python tools/sheets_mark_posted.py --angle-id <id> --post-url <url>`. If it fails, log the error and move on — the local audit file already captured the publish; a retry job can reconcile later.

## Output
- `temp/outputs/published/YYYY-WW.md` row appended (durable, written first)
- Sheet `angles` row updated: `status=Posted`, `date_posted`, `post_url` (best effort)
- Trigger [08_engagement_loop.md](08_engagement_loop.md) with the post URL

## Edge cases
- Unipile auth expired → halt, ask Labib to re-link the LinkedIn account in Unipile, do not retry blindly.
- `sheets_read_draft.py` returns empty body → halt; never publish a stub. Investigate the row in the Sheet first.
- Media upload fails → fall back to publishing as text-only and log the asset gap (don't silently skip).
- LinkedIn rejects the post (rare — usually content policy) → save the failure with the response body, alert Labib.
- Sheet sync fails AFTER successful publish → don't retry blindly; the publish record is already in `published/YYYY-WW.md`. Add to a future `tools/sheets_resync.py` punchlist.
- Sheet read fails BEFORE publish (network / token expired) → halt; we have no local fallback for the body in v1.1. Body lives only in the Sheet.

## Hand-off
Post URL goes to [08_engagement_loop.md](08_engagement_loop.md) immediately.
