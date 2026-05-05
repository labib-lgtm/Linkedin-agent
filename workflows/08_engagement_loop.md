# 08 — Engagement Loop

## Objective
Run the **first-60-minute protocol** after a post goes live: monitor incoming comments, draft replies for Labib's approval, and surface 3 ICP posts for him to comment on (the **1+3 rule**).

The first hour decides ~95% of a post's reach. This workflow exists to make sure Labib actually shows up in that window.

## When to run
Triggered by [07_publish.md](07_publish.md) the moment a post goes live. Active for 60 minutes; lighter check-ins at +2h, +6h, +24h.

## Inputs
- Published post URL
- Unipile creds (see [07_publish.md](07_publish.md))
- ICP keyword list for finding posts to comment on (`amazon ppc`, `tacos`, `acos`, `amazon dsp`, `a+ content`, etc.)

## Tools
- `tools/unipile_monitor_comments.py` — polls comments on a given post URL every 2 min for the first 60 min, then every 30 min for 5 hours. **Detects CTA-keyword comments** (case-insensitive word-boundary match against the angle's `cta_keyword`), writes a `queued` row to the `lead_magnet_recipients` table in Supabase, and fires the Trigger.dev `cta-comment-response` task via `trigger_engagement.py`. Maintains a seen-comments cache at `temp/outputs/engagement/<angle_id>-seen.json` so re-runs don't double-fire.
- `tools/trigger_engagement.py` — wraps the Trigger.dev REST API to fire the engagement-loop task. Reads `TRIGGER_SECRET_KEY` from `.env`. Importable function: `trigger_cta_response(...)`.
- **Trigger.dev task** [trigger/engagement_loop.ts](../trigger/engagement_loop.ts) — handles the locked T+0 → T+3h → T+3h sequence. Calls Unipile to post the public reply, send the DM, and post the follow-up reply. Patches the recipient row's `status` and timestamps in Supabase via the service-role key. **Required Trigger.dev env vars:** `UNIPILE_API_KEY`, `UNIPILE_DSN`, `UNIPILE_LINKEDIN_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `tools/unipile_find_icp_posts.py` — (future) searches LinkedIn for recent posts from ICP profiles or matching keywords
- `tools/draft_replies.py` — (future) for each new non-CTA comment, drafts a reply in Labib's voice
- `tools/draft_comments.py` — (future) for each ICP post, drafts a thoughtful comment

## The 1+3 rule
For every 1 post Labib publishes, he should also leave 3 substantive comments on other ICP creators' posts within the first 2 hours. These often outperform the original post for SOV.

## CTA-comment auto-response sequence (locked 2026-05-04)

When a commenter types the angle's `cta_keyword` on the live post, the agent runs a **3-hour delayed two-touch public sequence with a private DM in the middle**, NOT an instant DM.

| When | Action | Surface | Owned by |
|---|---|---|---|
| T+0 (CTA detected) | Public reply: "Sharing soon, sit tight." | Comment thread | Trigger.dev task |
| T+3h | DM the commenter the lead-magnet URL | Private DM | Trigger.dev task |
| T+3h (immediately after the DM) | Public reply: "Just sent it to your DMs." | Comment thread | Trigger.dev task |

The two-touch public sequence keeps engagement on the post alive past the first-hour reach window and reads less salesy than instant DM. Trigger.dev's durable `wait.for({ hours: 3 })` survives worker restarts, so the timer is reliable across days/weeks.

## Steps
1. **Start the CTA monitor** the moment 07_publish reports a live URL:
   ```
   python3 tools/unipile_monitor_comments.py --angle-id <id>
   ```
   Leave it running — it auto-tapers polling cadence and exits after the 6-hour window unless `--indefinite`. Each CTA match writes a recipient row and fires the Trigger.dev task.
2. **In parallel, surface 3 recent ICP posts** worth commenting on (future: `unipile_find_icp_posts.py`).
3. **Draft replies for non-CTA comments** and outbound comments — present as a queue in chat (future).
4. Labib approves / edits / rejects each non-automated reply. Approved ones publish via Unipile.
5. After 60 min, the monitor drops to every 30 min for the next 5 hours, then exits unless `--indefinite`.

## Output
- `temp/outputs/engagement/YYYY-WW/<post-slug>.md` — full log: incoming comments, replies sent, outbound comments sent.

## Edge cases
- A negative / hostile comment → never auto-draft a reply; flag for Labib only.
- A genuine question from a serious prospect → flag with a 🔥 marker so it doesn't get lost in noise.
- Unipile rate limit during polling → back off, don't crash.

## Hand-off
Engagement data is read by [09_performance_review.md](09_performance_review.md) at week's end.
