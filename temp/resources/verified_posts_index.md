# Verified LinkedIn Posts — Append-Only Index

Append-only log of every post URL I've successfully pulled from public sources. Becomes seed data for [09_performance_review.md](../../workflows/09_performance_review.md) once Unipile is wired.

Format: `| YYYY-MM-DD pulled | post_url | likes | comments | format | topic |`

---

| Pulled | URL | Likes | Comments | Format | Topic |
|---|---|---|---|---|---|
| 2026-05-03 | https://www.linkedin.com/posts/labibjaved_amazon-activity-7107035089246597120-Pz7l | 11 | 2 | text+7 hashtags | Keyword cannibalization in Amazon PPC |

---

## Search log (do not repeat)

| Date | Pass | Angles tried | Result |
|---|---|---|---|
| 2026-05-03 | 1 | profile URL, recent-activity URL, PK mirror, name+company, URL pattern, topic-specific (PPC/ACoS/A+/DSP/case study), Bing | 1 post |
| 2026-05-03 | 2 (older-posts focus) | year-restricted, activity-prefix, topic variants (sponsored brands/storefront/keyword), bidding/budget/CTR, podcast/interview, lynxmedia.co + DesignRush + RocketReach | 0 new posts (verified 3 case study numbers from lynxmedia.co — see audit_baseline §6) |

**Conclusion:** LinkedIn deindexes personal post pages from public search engines. Public-web scraping caps out at 1 of 44. Don't run further open-web searches — the gap requires authenticated access (Playwright MCP / Unipile / CSV export / direct paste).
