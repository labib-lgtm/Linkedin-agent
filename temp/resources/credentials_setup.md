# Credentials & API Setup Guide

Everything the agent needs to actually publish, read, and engage on your LinkedIn. **One mandatory service: Unipile.** Google Drive is already wired.

---

## TL;DR — what you need to put in [.env](../../.env)

```
UNIPILE_API_KEY=ux_xxxxxxxxxxxxxxxxx
UNIPILE_DSN=apiN.unipile.com:13NNN
UNIPILE_LINKEDIN_ACCOUNT_ID=xxxxxxxxxxxxxxxxxx
```

That's it. Three values. ~15 minutes of setup.

---

## 1. Unipile — the only mandatory service

### What it does for us
| Workflow | What Unipile enables |
|---|---|
| [07_publish.md](../../workflows/07_publish.md) | Publish posts + first comments to your LinkedIn |
| [02_creator_tracker.md](../../workflows/02_creator_tracker.md) | Pull recent posts from the 8 tracked creators |
| [08_engagement_loop.md](../../workflows/08_engagement_loop.md) | Monitor comments on your post, draft replies, send auto-DMs to anyone commenting CTA keywords (AUDIT/STACK/METRICS) |
| [09_performance_review.md](../../workflows/09_performance_review.md) | Pull metrics on your posts (impressions, reactions, comments, reposts) |

**Why not the official LinkedIn API:** LinkedIn's Marketing Developer Platform requires app approval, which is functionally closed for solo developers and small agencies. Unipile uses session-based auth (your own login), which works the same way you'd use LinkedIn from your browser — just programmatically.

### Step-by-step setup

**Step 1 — Create account**
- Go to https://www.unipile.com → Sign up
- Use `labib@lynxmedia.co`

**Step 2 — Pick a plan**
| Plan | Price | LinkedIn accounts | Notes |
|---|---|---|---|
| Hobby (free trial) | $0 | 1 | Limited messages/day. Fine for initial testing only. |
| **Starter** | ~$59/mo | 1 | Recommended for solo creator workflow |
| Business | $200+ /mo | 5+ | Only if you'll run accounts for clients later |

→ Start with **Starter**. Upgrade only if you outgrow rate limits.

**Step 3 — Connect your LinkedIn account**
- Dashboard → Connected Accounts → "+ Add Account" → LinkedIn
- A popup opens. Log in with your normal LinkedIn email/password.
- (Recommended: enable 2FA on LinkedIn first, since this account is now also accessible programmatically.)
- Once connected, Unipile shows the account in the dashboard with an **Account ID** — copy it.

**Step 4 — Create an API key**
- Dashboard → Settings → Developers → API Keys → "Create new key"
- Name it: `linkedin-agent-prod`
- Permissions: enable **all LinkedIn scopes** (read posts, write posts, read messages, write messages, read comments)
- The key is shown ONCE — copy it now into a password manager AND `.env`

**Step 5 — Find your DSN**
- Top of every Unipile dashboard page shows your dedicated subdomain — looks like `api3.unipile.com:13311` (the `N` and port vary per customer)
- This goes into `UNIPILE_DSN`

**Step 6 — Drop into [.env](../../.env)**
```
UNIPILE_API_KEY=ux_xxxxxxxxxxxxxxxxx
UNIPILE_DSN=api3.unipile.com:13311
UNIPILE_LINKEDIN_ACCOUNT_ID=xxxxxxxxxxxxxxxxxx
```

**Step 7 — Quick sanity test**
After you drop the values in, tell me "Unipile keys are in" and I'll run a one-line test (fetch your own profile via Unipile) to confirm the connection works before we build anything that depends on it.

---

## 2. Google Drive / Sheets — already done

You authenticated the Claude Drive MCP earlier in this session (that's how I read your growth plan). No `.env` entry needed for the OAuth flow.

The relevant sheet IDs are referenced in `.env`:
- `LYNX_GROWTH_PLAN_SHEET_ID` — your 60-post strategy (✅ already set)
- `LYNX_CLIENT_PATTERN_SHEET_ID` — the anonymized client outcomes sheet (still TBD — see [03_topic_pipeline.md](../../workflows/03_topic_pipeline.md))

**The client pattern sheet** is the moat for non-generic content beyond the 10 already drafted. Recommended structure (one row per Lynx engagement):

| Column | Example |
|---|---|
| client_anon | "Brand A" |
| vertical | Supplements |
| starting_acos | 38% |
| starting_tacos | 24% |
| starting_spend_mo | $4,300 |
| changes_made | "Killed 80% of keywords; added Top-of-Search multiplier; rewrote A+ Content" |
| ending_acos | 19% |
| ending_tacos | 11% |
| ending_spend_mo | $7,800 |
| time_to_result | "8 weeks" |
| public_to_share | yes / no / anonymized only |

Even 5 rows of this transforms what we can ship. Want me to scaffold this sheet now via the Drive MCP?

---

## 3. Optional / downstream

You don't need these to start. Add when you hit them.

| Service | When to add | Why |
|---|---|---|
| **Dub.co** (or bit.ly) | Once posts have lead-magnet links in DMs | Track which posts → which DMs → which clicks → which deals |
| **Calendly link** | Now if you have one | Used in the AUDIT funnel: comment AUDIT → DM with Sheet + Calendly. Drop into `CALENDLY_LINK=` |
| **Anthropic API key** | Only if we ever run tools outside Claude Code | Right now Claude IS the agent, so no separate key needed |
| **OpenAI API key** | If you choose any non-Anthropic model for tools | Same — not needed unless we add OpenAI-specific tools |

---

## 4. Security checklist before you go live

- [ ] `.env` file confirmed in `.gitignore` (already done)
- [ ] `.env` never pasted into chat, Slack, screenshots, etc.
- [ ] Unipile API key has only the LinkedIn scopes enabled, not other platforms
- [ ] LinkedIn 2FA enabled on your personal account
- [ ] Unipile dashboard password is in your password manager
- [ ] Decide: who else on the Lynx team needs Unipile access? (Add as separate users in Unipile, not by sharing the API key.)

---

## What happens after the keys land

1. I write [tools/unipile_client.py](../../tools/) — a tiny shared client that all Unipile tools import (auth headers, base URL, error handling)
2. I write [tools/unipile_publish.py](../../tools/) — used by [07_publish.md](../../workflows/07_publish.md)
3. I write [tools/unipile_get_my_posts.py](../../tools/) — used by [09_performance_review.md](../../workflows/09_performance_review.md) — also pulls your historical 44 posts the *first* time it runs, finally giving us real winners data
4. I write [tools/unipile_monitor_comments.py](../../tools/) — used by [08_engagement_loop.md](../../workflows/08_engagement_loop.md), including auto-DM responder for AUDIT/STACK/METRICS keywords
5. I write [tools/unipile_get_creator_posts.py](../../tools/) — used by [02_creator_tracker.md](../../workflows/02_creator_tracker.md)

Total build time after keys arrive: ~1–2 hours of focused work, then test on Post 1 (Monday W1) before scheduling the rest.
