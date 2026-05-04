"""Score the posts pulled by unipile_get_my_posts.py.

Scoring (per workflows/09_performance_review.md priority order):
  - reposts (5x) — distribution multiplier, scarcest
  - comments (3x) — top-of-funnel signal
  - reactions (1x) — vanity baseline
  - reposts and comments first because saves/sends aren't returned by Unipile's posts list

Outputs:
  temp/outputs/post_winners_2026-05-03.md — ranked table + winners/losers analysis
"""
from __future__ import annotations

import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RAW = PROJECT_ROOT / "temp" / "resources" / "my_posts_raw.json"
OUT = PROJECT_ROOT / "temp" / "outputs" / "post_winners_2026-05-03.md"


def normalize(p: dict) -> dict:
    text = (p.get("text") or "").strip()
    impressions = int(p.get("impressions_counter") or 0)
    reactions = int(p.get("reaction_counter") or 0)
    comments = int(p.get("comment_counter") or 0)
    reposts = int(p.get("repost_counter") or 0)
    score = reactions * 1 + comments * 3 + reposts * 5
    eng_rate = ((reactions + comments + reposts) / impressions) if impressions else 0.0
    return {
        "id": p.get("id"),
        "social_id": p.get("social_id"),
        "url": p.get("share_url"),
        "posted": p.get("parsed_datetime"),
        "text": text,
        "is_repost": bool(p.get("is_repost")),
        "impressions": impressions,
        "reactions": reactions,
        "comments": comments,
        "reposts": reposts,
        "score": score,
        "eng_rate": eng_rate,
        "first_line": text.split("\n", 1)[0][:140] if text else "",
        "char_count": len(text),
    }


def categorize(posts: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    if not posts:
        return [], [], []
    scores = [p["score"] for p in posts]
    p75 = statistics.quantiles(scores, n=4)[2] if len(scores) >= 4 else max(scores)
    p25 = statistics.quantiles(scores, n=4)[0] if len(scores) >= 4 else 0
    winners = [p for p in posts if p["score"] >= p75 and p["score"] > 0]
    losers = [p for p in posts if p["score"] <= p25]
    middle = [p for p in posts if p25 < p["score"] < p75]
    winners.sort(key=lambda p: p["score"], reverse=True)
    losers.sort(key=lambda p: p["score"])
    return winners, middle, losers


def md_table_row(p: dict, rank: int) -> str:
    snippet = p["first_line"].replace("|", "\\|")
    return f"| {rank} | {p['posted'][:10] if p['posted'] else '?'} | {p['score']} | {p['reactions']} | {p['comments']} | {p['reposts']} | {p['impressions']} | {p['eng_rate']*100:.2f}% | {snippet} |"


def main() -> None:
    raw = json.loads(RAW.read_text())
    posts = [normalize(p) for p in raw["posts"]]
    originals = [p for p in posts if not p["is_repost"]]
    reposts_only = [p for p in posts if p["is_repost"]]

    originals.sort(key=lambda p: p["posted"] or "", reverse=True)
    winners, middle, losers = categorize(originals)

    # Aggregate stats
    total_imps = sum(p["impressions"] for p in originals)
    total_reactions = sum(p["reactions"] for p in originals)
    total_comments = sum(p["comments"] for p in originals)
    total_reposts = sum(p["reposts"] for p in originals)
    median_imps = statistics.median([p["impressions"] for p in originals]) if originals else 0
    median_score = statistics.median([p["score"] for p in originals]) if originals else 0

    lines: list[str] = []
    lines.append(f"# Post Performance — Winners & Losers (2026-05-03)")
    lines.append("")
    lines.append(f"**Source:** Unipile pull of {len(posts)} total items ({len(originals)} original posts, {len(reposts_only)} reposts).")
    lines.append(f"**Scoring:** `reactions × 1 + comments × 3 + reposts × 5`. Reposts > comments > reactions per [09_performance_review.md](../../workflows/09_performance_review.md).")
    lines.append("")
    lines.append("## Aggregate")
    lines.append("")
    lines.append(f"| Metric | Value |")
    lines.append(f"|---|---|")
    lines.append(f"| Original posts | {len(originals)} |")
    lines.append(f"| Reposts of others | {len(reposts_only)} |")
    lines.append(f"| Total impressions | {total_imps:,} |")
    lines.append(f"| Total reactions | {total_reactions:,} |")
    lines.append(f"| Total comments | {total_comments:,} |")
    lines.append(f"| Total reposts received | {total_reposts:,} |")
    lines.append(f"| Median impressions/post | {median_imps:,.0f} |")
    lines.append(f"| Median score | {median_score:.0f} |")
    lines.append("")

    lines.append("## Winners (top quartile by score)")
    lines.append("")
    lines.append("| # | Date | Score | ❤️ | 💬 | 🔁 | Imp | Eng% | Hook |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for i, p in enumerate(winners, 1):
        lines.append(md_table_row(p, i))
    lines.append("")

    lines.append("### Winner full text (top 5)")
    lines.append("")
    for i, p in enumerate(winners[:5], 1):
        lines.append(f"#### W{i} — score {p['score']} · {p['reactions']}❤️ {p['comments']}💬 {p['reposts']}🔁 · {p['impressions']:,} imp · {p['eng_rate']*100:.2f}%")
        lines.append(f"[link]({p['url']}) — posted {p['posted'][:10] if p['posted'] else '?'} — {p['char_count']} chars")
        lines.append("")
        lines.append("```")
        lines.append(p["text"])
        lines.append("```")
        lines.append("")

    lines.append("## Losers (bottom quartile by score)")
    lines.append("")
    lines.append("| # | Date | Score | ❤️ | 💬 | 🔁 | Imp | Eng% | Hook |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for i, p in enumerate(losers, 1):
        lines.append(md_table_row(p, i))
    lines.append("")

    lines.append("## Loser full text (bottom 5)")
    lines.append("")
    for i, p in enumerate(losers[:5], 1):
        lines.append(f"#### L{i} — score {p['score']} · {p['reactions']}❤️ {p['comments']}💬 {p['reposts']}🔁 · {p['impressions']:,} imp")
        lines.append(f"[link]({p['url']}) — posted {p['posted'][:10] if p['posted'] else '?'}")
        lines.append("")
        lines.append("```")
        lines.append(p["text"][:1200])
        lines.append("```")
        lines.append("")

    lines.append("## All originals (newest first)")
    lines.append("")
    lines.append("| # | Date | Score | ❤️ | 💬 | 🔁 | Imp | Eng% | Hook |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for i, p in enumerate(originals, 1):
        lines.append(md_table_row(p, i))
    lines.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
