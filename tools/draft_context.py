"""Gather all writing context for one approved angle into a single bundle.

The agent reads the bundle when drafting. Bundle includes:
  1. The angle row from the Sheet (hook_seed, pillar, format, CTA, notes, etc.)
  2. The 5 winning patterns (P1-P6) from winners_memory.md
  3. The top 3 topically-closest historical winners from my_posts_raw.json
     (selected by hashtag/keyword overlap with the angle's hook)
  4. Brand voice anchors from references/lynx-brand.md (§5)
  5. Killed-topics list — angles already proven not to work

Output: temp/outputs/drafts/<angle_id>-context.md (markdown bundle)

This is a deterministic gather step. The actual writing is done by the agent
using this bundle as input.

Run: python3 tools/draft_context.py --angle-id <id> [--out <path>]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(0, str(PROJECT_ROOT / "tools"))
from sheets_client import header_map, worksheet


def topical_keywords(hook: str) -> set[str]:
    """Extract candidate keywords from the angle hook for similarity matching."""
    text = hook.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    stopwords = {
        "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at",
        "for", "with", "is", "are", "was", "were", "you", "your", "we", "our",
        "i", "it", "this", "that", "these", "those", "they", "them", "their",
        "be", "been", "being", "have", "has", "had", "do", "does", "did",
        "will", "would", "could", "should", "can", "may", "might", "must",
        "than", "then", "so", "if", "as", "up", "down", "out", "off",
        "from", "by", "into", "about", "after", "before", "over", "under",
    }
    words = {w for w in text.split() if len(w) > 3 and w not in stopwords}
    return words


def get_angle_row(angle_id: str) -> dict:
    ws = worksheet("angles")
    rows = ws.get_all_records()
    for r in rows:
        if str(r.get("angle_id", "")).strip() == angle_id:
            return r
    sys.exit(f"angle_id not found: {angle_id}")


def get_topical_winners(hook: str, n: int = 3) -> list[dict]:
    """Top N closest historical winners by keyword overlap."""
    raw_path = PROJECT_ROOT / "temp" / "resources" / "my_posts_raw.json"
    if not raw_path.exists():
        return []
    raw = json.loads(raw_path.read_text())
    angle_kw = topical_keywords(hook)
    if not angle_kw:
        return []

    scored: list[tuple[float, dict]] = []
    for p in raw.get("posts", []):
        if p.get("is_repost"):
            continue
        text = (p.get("text") or "").lower()
        post_kw = topical_keywords(text[:1000])
        overlap = len(angle_kw & post_kw)
        # Engagement weight (so we prefer winners not just any topical match)
        score_base = (
            int(p.get("reaction_counter") or 0)
            + 3 * int(p.get("comment_counter") or 0)
            + 5 * int(p.get("repost_counter") or 0)
        )
        if overlap and score_base > 5:
            scored.append((overlap * (score_base ** 0.5), p))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [p for _, p in scored[:n]]


def read_winners_memory() -> str:
    p = PROJECT_ROOT / "temp" / "resources" / "winners_memory.md"
    return p.read_text() if p.exists() else "(winners_memory.md not found)"


def read_voice_anchors() -> str:
    p = PROJECT_ROOT / "references" / "lynx-brand.md"
    if not p.exists():
        return "(lynx-brand.md not found)"
    txt = p.read_text()
    # Pull §5 only (Brand voice section)
    m = re.search(r"## 5\. Brand voice(.+?)(?=^## 6\.|^---\s*\n## )", txt, re.DOTALL | re.MULTILINE)
    return ("## 5. Brand voice" + m.group(1)).strip() if m else txt[:3000]


def get_killed_topics() -> list[dict]:
    try:
        ws = worksheet("killed_topics")
        return ws.get_all_records()
    except Exception:
        return []


def build_bundle(angle: dict, winners: list[dict], killed: list[dict]) -> str:
    lines: list[str] = []
    lines.append(f"# Draft Context Bundle — {angle['angle_id']}")
    lines.append("")
    lines.append("This bundle contains everything the writer needs to draft this post in Labib's voice with his data. **Use it. Don't write a generic Amazon-PPC post — write THIS post grounded in the patterns and proof below.**")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 1. The angle (Sheet row)")
    lines.append("")
    for k in ("angle_id", "pillar", "format", "cta_keyword", "winner_patterns", "gap_filled", "week_assigned", "notes"):
        v = angle.get(k, "")
        if v:
            lines.append(f"- **{k}:** {v}")
    lines.append("")
    lines.append("**Hook draft (starting point — the agent should expand and tighten, not copy verbatim):**")
    lines.append("")
    lines.append("```")
    lines.append(str(angle.get("hook_seed", "")).strip())
    lines.append("```")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 2. Winning patterns to enforce (every draft must hit ≥4)")
    lines.append("")
    lines.append(read_winners_memory())
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"## 3. Topically-closest historical winners (top {len(winners)})")
    lines.append("")
    if not winners:
        lines.append("_No closely-matching prior posts found. Lean harder on the patterns + audit gap._")
    for i, w in enumerate(winners, 1):
        score = (
            int(w.get("reaction_counter") or 0)
            + 3 * int(w.get("comment_counter") or 0)
            + 5 * int(w.get("repost_counter") or 0)
        )
        lines.append(f"### #{i} — score {score} ({w.get('reaction_counter',0)}❤️ {w.get('comment_counter',0)}💬 {w.get('repost_counter',0)}🔁 · {w.get('impressions_counter',0)} imp)")
        lines.append(f"[link]({w.get('share_url','')})")
        lines.append("")
        lines.append("```")
        lines.append((w.get("text") or "").strip()[:1500])
        lines.append("```")
        lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 4. Brand voice (enforce upstream, not as a final pass)")
    lines.append("")
    lines.append(read_voice_anchors())
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"## 5. Killed topics — DO NOT regenerate ({len(killed)})")
    lines.append("")
    if killed:
        for k in killed:
            lines.append(f"- **{k.get('killed_id','?')}:** {k.get('topic_summary','')[:120]} _(reason: {k.get('reason','')})_")
    else:
        lines.append("_No killed topics yet._")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 6. Drafting protocol (the writer follows this exactly)")
    lines.append("")
    lines.append("1. **Generate 3 hook variants**, each targeting a different winning pattern:")
    lines.append("   - **Hook A** — \"specific number + outcome\" (W1, W3 style)")
    lines.append("   - **Hook B** — \"two-line contradiction\" (W2, W4 style)")
    lines.append("   - **Hook C** — \"reader-state question\" or \"uncomfortable claim\"")
    lines.append("2. **Draft the body** (≤ 2,000 chars, single idea per paragraph, story arc not listicle).")
    lines.append("3. **End with the lead-magnet CTA** — \"Comment <KEYWORD> and I'll send <ASSET>.\" Never put a link in the post body.")
    lines.append("4. **Run draft_critic.py against the output** — if any P1–P6 pattern fails, revise once.")
    lines.append("5. **Output to** `temp/outputs/drafts/YYYY-WW/<slug>.md` with the angle_id in the front-matter.")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--out", default=None, help="Output path (default temp/outputs/drafts/<id>-context.md)")
    args = ap.parse_args()

    angle = get_angle_row(args.angle_id)
    winners = get_topical_winners(angle.get("hook_seed", ""), n=3)
    killed = get_killed_topics()
    bundle = build_bundle(angle, winners, killed)

    out_path = (
        Path(args.out) if args.out
        else PROJECT_ROOT / "temp" / "outputs" / "drafts" / f"{args.angle_id}-context.md"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(bundle)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
