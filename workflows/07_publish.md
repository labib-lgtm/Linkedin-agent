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
- `tools/sheets_read_draft.py` — pulls the `draft_body` (and metadata) from Supabase for the given `angle_id`
- `tools/unipile_publish.py` — reads the angle record, branches on `format` (text / image / carousel / poll), uploads media if needed, POSTs to Unipile's LinkedIn publish endpoint, optionally posts a first-comment, writes the local audit row + an `audit_log` event in Supabase, and calls `sheets_mark_posted.py`. Manual gate by default; pass `--auto` to skip the `[y/n]` preview prompt.
- `tools/sheets_mark_posted.py` — flips the angle record to `Posted`, stamps `date_posted` + `post_url`

(Tool filenames keep the `sheets_*` prefix for backwards compatibility; the implementations now read/write Supabase, not Google Sheets.)

## Unipile endpoints used
- `POST /api/v1/posts` — publish (text-only via JSON body; image / carousel via multipart with `attachments` field). Body fields: `account_id`, `text`, optional `attachments` (file).
- `POST /api/v1/posts/<post_id>/comments` — first-comment publish (run ~10s after the post lands). Body: `account_id`, `text`.
- Auth: `X-API-KEY` header. Base URL from `UNIPILE_DSN` env var.

## Steps
1. Read the scheduled item (carries the `angle_id`).
2. **Run the publish tool.**
   ```
   python3 tools/unipile_publish.py --angle-id <id>
   ```
   The tool internally:
   - Reads the angle record from Supabase (status must be `Visual Ready`, `Drafted` (text-only), or `Scheduled`)
   - Resolves the asset from `asset_path` for image / carousel formats
   - Manual gate (default): prints the body + asset preview + size and waits for `[y/n]`
   - Calls Unipile to publish (multipart for media, JSON for text)
   - If `--first-comment-file <path>` is supplied, sleeps 10s and posts the first comment
   - Appends the publish row to `temp/outputs/published/YYYY-WW.md` AND inserts an `audit_log` event in Supabase
   - Calls `sheets_mark_posted.py` to flip status / stamp post_url
3. **Auto mode** (only after 4 weeks of trust): pass `--auto` to skip the `[y/n]` preview prompt.
4. Hand off to [08_engagement_loop.md](08_engagement_loop.md) — start `tools/unipile_monitor_comments.py` against the new post URL within the first 60 minutes.

## Output
- `temp/outputs/published/YYYY-WW.md` row appended (durable, written first)
- Supabase `angles` record updated: `status=Posted`, `date_posted`, `post_url` (best effort)
- `audit_log` event inserted with the publish payload
- Trigger [08_engagement_loop.md](08_engagement_loop.md) with the post URL

## Edge cases
- Unipile auth expired → halt, ask Labib to re-link the LinkedIn account in Unipile, do not retry blindly.
- `sheets_read_draft.py` returns empty body → halt; never publish a stub. Investigate the record in the webapp first.
- Media upload fails → fall back to publishing as text-only and log the asset gap (don't silently skip).
- LinkedIn rejects the post (rare — usually content policy) → save the failure with the response body, alert Labib.
- Supabase sync fails AFTER successful publish → don't retry blindly; the publish record is already in `published/YYYY-WW.md`. Reconcile by reading the audit row and patching the angle record manually.
- Supabase read fails BEFORE publish (network / wrong env vars) → halt; we have no local fallback for the body. Body lives only in Supabase.

## Hand-off
Post URL goes to [08_engagement_loop.md](08_engagement_loop.md) immediately.
