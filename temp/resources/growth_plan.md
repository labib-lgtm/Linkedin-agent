# Growth Plan — Working Snapshot
**Source of truth:** [Labib_Javed_30K_LinkedIn_Growth_Plan.xlsx](https://drive.google.com/file/d/1nWT1rMpxK_cVJDt5jMI0l78Fg1RYFAS1/view) (Google Sheet, owner: labib@lynxmedia.co)
**Mirrored:** 2026-05-03
**Scope this cycle:** 2 weeks (posts 1–10) — quality > volume

> The Google Sheet is canonical. Update it there, not here. This file is a project-local snapshot that the WAT workflows read so the agent can run offline.

---

## Current state (from doc dashboard)
| Metric | Now |
|---|---|
| Followers | 1,729 |
| Posts/week | ~1 |
| Avg comments/post | ~17 |
| Avg reactions/post | ~9 |
| Impressions/week | 5,632 |
| Videos/week | 0 |
| Newsletter subs | 0 |
| DMs/week | ~2 |

12–18 month target: **30,000 followers**. Phase timeline: Foundation → Traction → Compound → Acceleration → Authority → 30K.

---

## Locked decisions (this project)
| Decision | Choice |
|---|---|
| Scheduler / publishing | **Unipile API** (overrides Taplio in the doc) |
| Tracked creators | **8 total** — 4 Amazon-niche peers + 4 tactical pattern sources (see [02_creator_tracker.md](../../workflows/02_creator_tracker.md)) |
| Planning window | **2 weeks (10 posts)** then re-assess. Don't pre-commit further. |
| Posting timezone | US Eastern, ~8:00 AM weekdays |
| Formats | Text, image, carousel, poll, video (60 plan re-introduces video) |

---

## Next 2 weeks — 10 posts (draft-ready in the doc)

### Week 1
| # | Day | Format | Type | Hook | CTA |
|---|---|---|---|---|---|
| 1 | Mon | Image | Educational | "There's a column in your Search Term Report that's costing you thousands…" | — |
| 2 | Tue | Carousel (7 slides) | Case Study | "€8K Ad Spend. €11K Revenue. They thought PPC was working." | REVIEW |
| 3 | Wed | Text | Hot Take | "Your Amazon PPC agency is optimizing the wrong thing." | — |
| 4 | Thu | Video 60s | Video | "Let me show you something most Amazon sellers have never seen in their account." | AUDIT |
| 5 | Fri | Image | Lead Gen | "I built a tool that finds the exact search terms draining your ad budget." | AUDIT |

### Week 2
| # | Day | Format | Type | Hook | CTA |
|---|---|---|---|---|---|
| 6 | Mon | Text+Image | Educational | "Amazon's Sponsored Products has a setting most sellers leave on default…" | STRUCTURE |
| 7 | Tue | Image | Case Study | "Last Tuesday a seller DM'd me: 'I just realized my best campaign and worst campaign are the same campaign.'" | REVIEW |
| 8 | Wed | Carousel (10 slides) | Tool Roundup | "The complete Amazon seller's tech stack — 30+ tools…" | STACK |
| 9 | Thu | Video 45s | Video | "Here's a trick I use that most PPC managers don't know about." | AUDIT |
| 10 | Fri | Carousel (8 slides) | Cheat Sheet | "If Amazon PPC metrics still feel confusing, save this cheat sheet…" | METRICS (Save+Repost) |

**Full post bodies:** in the Google Sheet, "Content Calendar" tab, rows for posts 1–10.

---

## CTAs needed for the 2-week cycle
From the CTA Engine tab:

| Keyword | Resource | Used in posts | Build status |
|---|---|---|---|
| AUDIT | Profit Eliminator (web tool) | 4, 5, 9 | ✅ Done |
| STRUCTURE | Campaign Structure Template (Sheet) | 6 | Week 1 build |
| REVIEW | Free Account Review (service) | 2, 7 | Ongoing |
| STACK | Tool Stack spreadsheet (30+ tools) | 8 | Week 3 in doc — **bring forward to Week 2** |
| METRICS | PPC Metrics Cheat Sheet (PDF) | 10 | Week 2 build |

**Action:** STACK and METRICS need to be built before posts 8 and 10 ship.

---

## Engagement targets (8 creators, two groups)

### Group A — Amazon-niche peers (track for SOV + topic competition)
| Tier | Creator | Why |
|---|---|---|
| 1 | Destaney Wishon (BetterAMS) | Closest analog to Lynx positioning |
| 2 | Brandon Young (Data Dive) | 8-fig seller perspective |
| 2 | Joe Shelerud (Ad Advance) | DSP-heavy content |
| 2 | Elizabeth Greene (Junglr) | Direct PPC agency competitor |

### Group B — Tactical pattern sources (steal hooks/formats, not topics)
| Tier | Creator | Why |
|---|---|---|
| 2 | Vadim Soin (PPC Jumpstart) | Direct competitor + cheat-sheet/glossary format winner |
| 2 | Brigitta Ruha (Growth Today) | Tool-roundup + 4-tier framework master |
| 2 | Travis Moh (AdPush Media) | Contrarian-hook formula winner ("Everyone says X…") |
| 2 | Zsolt Kovacs (oartconsult) | "Invisible problem" naming pattern |

Plus the doc's Tier 1 (daily) Amazon-influencer engagement targets: Nik Hall, John Aspinall, Steven Pope, Kamaljit Singh, Kevin King.

---

## Daily playbook (80 min/day)
| Time (ET) | Action | Duration |
|---|---|---|
| 8:00 AM | Publish post (pre-scheduled) | 2 min |
| 8:00–8:30 | Comment on 10 target-account posts (3+ sentences) | 30 min |
| 10:00 AM | Reply to every comment on YOUR post + Taplio CTA auto-DMs | 15 min |
| 12:00 PM | Comment on 5 more target posts | 15 min |
| 3:00 PM | Reply to new comments + send pending DMs + accept connection requests | 10 min |
| 6:00 PM | Final sweep + 10 personalized connection requests to Amazon sellers | 10 min |

> Note: doc says Taplio for auto-DM. With Unipile we can replicate this — Unipile supports DMs and comment monitoring. See [08_engagement_loop.md](../../workflows/08_engagement_loop.md).

---

## Profile updates (P0 Day 1 from doc)
- New headline (in doc, "Profile Rewrite" tab)
- New About section (€29M+ managed, specific outcomes)
- Trim services to 6 Amazon-only items
- Pin 3 to Featured (AUDIT post + €14K→€53K case study + 30s intro video)

---

## What this doc does NOT cover (still need)
- The 2 weeks 3–12 posts (Topic Ready, not Draft Ready) — defer until weeks 1–2 ship and we measure
- Anonymized client pattern sheet (the moat) — still needed for posts beyond what's already drafted
- Unipile account connection + tools/unipile_publish.py
- Performance review tooling (will baseline against the dashboard metrics above)
