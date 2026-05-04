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
- `tools/unipile_monitor_comments.py` — polls comments on a given post URL every 2–5 min for 60 min
- `tools/unipile_find_icp_posts.py` — searches LinkedIn for recent posts from ICP profiles or matching keywords
- `tools/draft_replies.py` — for each new comment, drafts a reply in Labib's voice (uses `brand-voice`)
- `tools/draft_comments.py` — for each ICP post, drafts a thoughtful comment (not "great post!")

## The 1+3 rule
For every 1 post Labib publishes, he should also leave 3 substantive comments on other ICP creators' posts within the first 2 hours. These often outperform the original post for SOV.

## Steps
1. Start polling comments on the new post.
2. In parallel, surface 3 recent ICP posts worth commenting on.
3. Draft replies and outbound comments — present as a queue in chat.
4. Labib approves / edits / rejects each. Approved ones publish via Unipile.
5. After 60 min, drop polling cadence to every 30 min for the next 5 hours.

## Output
- `temp/outputs/engagement/YYYY-WW/<post-slug>.md` — full log: incoming comments, replies sent, outbound comments sent.

## Edge cases
- A negative / hostile comment → never auto-draft a reply; flag for Labib only.
- A genuine question from a serious prospect → flag with a 🔥 marker so it doesn't get lost in noise.
- Unipile rate limit during polling → back off, don't crash.

## Hand-off
Engagement data is read by [09_performance_review.md](09_performance_review.md) at week's end.
