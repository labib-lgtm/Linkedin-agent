"""Score a draft post against the P1–P6 winning patterns.

Returns JSON with per-pattern pass/fail + suggested fixes for any miss.
The agent reads this and revises the draft once before final output.

Patterns:
  P1 — Currency in line 1 or 2 ($/€/£/¥/USD/EUR/GBP)
  P2 — Two-line contradiction hook (setup → contradiction)
  P3 — Story arc, not a Step 1/2/3 framework
  P4 — Two concrete before/after numbers (CVR, ACoS, %, etc.)
  P5 — One-word lead-magnet keyword + DM funnel
  P6 — Internal vocabulary (named pattern) — bonus, not required

Run: python3 tools/draft_critic.py --draft <path> [--cta-keyword <KW>]
     python3 tools/draft_critic.py --text "<paste post body>"
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Currency or number-with-currency-prefix in the first 2 non-empty lines
CURRENCY_RE = re.compile(
    r"(\$|€|£|¥|USD|EUR|GBP|JPY|CAD|AUD)\s?[\d,]+(?:\.\d+)?[KkMm]?\b|"
    r"\b\d[\d,]*(?:\.\d+)?[KkMm]?\s?(?:dollars|euros|pounds|usd|eur|gbp)\b",
    re.IGNORECASE,
)

# A clearly numeric metric (CVR/ACoS/CTR/%/× etc.) — used for P4
METRIC_RE = re.compile(
    r"\b\d+(?:\.\d+)?\s?%(?:\s?[A-Za-z]{2,5})?|"   # 12.4% / 18% ACoS
    r"\b\d+(?:\.\d+)?\s?x\b|"                       # 3x
    r"\bACoS\s*(?:of)?\s*\d|"                        # ACoS 23
    r"\bCVR\s*(?:of|at)?\s*\d|"                      # CVR 4.8
    r"\bROAS\s*(?:of|at)?\s*\d",
    re.IGNORECASE,
)

# Listicle-y framework markers (P3 violation if too many)
LISTICLE_RE = re.compile(
    r"\b(step\s+\d+|tip\s+\d+|reason\s+\d+|secret\s+\d+|tactic\s+\d+|\d+\s+ways|\d+\s+things|\d+\s+rules)\b",
    re.IGNORECASE,
)

# CTA pattern — needs ALL CAPS one-word keyword + comment instruction (P5)
CTA_RE = re.compile(
    r"comment\s+[\"']?([A-Z]{3,15})[\"']?\s+(?:below|and)|"
    r"drop\s+[\"']?([A-Z]{3,15})[\"']?\s+(?:in|below|and)|"
    r"[\"']([A-Z]{3,15})[\"']\s+below",
    re.IGNORECASE,
)

# Filler / generic phrases to flag as voice violations (cue for revision)
FILLER_PHRASES = [
    "happy to share", "humbled and honored", "thrilled to announce",
    "let's dive in", "in this post", "stay tuned", "without further ado",
    "in today's fast-paced world", "at the end of the day",
    "needless to say", "to be honest", "in my humble opinion",
]

# AI-tell characters Labib explicitly disallows (locked 2026-05-04).
# No em-dashes, no markdown bold/italic, no trailing hashtag blocks.
EM_DASH_RE = re.compile(r"—")  # the unicode em-dash (U+2014)
MARKDOWN_BOLD_RE = re.compile(r"\*\*[^*\n]+\*\*")
MARKDOWN_ITALIC_RE = re.compile(r"(?<![\*\w])\*[^*\n]+\*(?!\*)")
HASHTAG_BLOCK_RE = re.compile(r"(?:^|\n)\s*(?:#[A-Za-z0-9_]{2,}\s*){2,}")


def first_n_lines(text: str, n: int = 2) -> str:
    """Return the first N non-empty lines."""
    lines = [ln for ln in text.splitlines() if ln.strip()]
    return "\n".join(lines[:n])


def check_p1(text: str) -> dict:
    """Currency early in the post. Loosened to first 250 chars (≈ above-the-fold
    region on LinkedIn mobile). Empirically 2/4 winners had it in lines 1-2,
    but all 4 had it within the first ~250 chars."""
    head = text[:250]
    has = bool(CURRENCY_RE.search(head))
    return {
        "id": "P1",
        "name": "Currency above the fold (~250 chars)",
        "pass": has,
        "fix": None if has else "Add a $/€/£ amount within the first 250 chars (above the LinkedIn fold). Anchor in real client numbers — audit baseline §6 has $29M, $14K/mo, +293%, +182%, +300%, etc.",
    }


def check_p2(text: str) -> dict:
    """Two-line contradiction hook: a setup → reveal/contradiction in lines 1-3.
    Heuristic: two short lines with a connector or a sharp pivot.
    """
    lines = [ln for ln in text.splitlines() if ln.strip()][:3]
    if len(lines) < 2:
        return {"id": "P2", "name": "Two-line contradiction hook", "pass": False,
                "fix": "Open with two short lines — setup, then contradiction. e.g. 'We doubled the budget. Sales barely moved.'"}
    # Look for contradiction signal in line 2 OR a follow-up that subverts line 1
    contradiction_signals = re.compile(
        r"\b(but|however|except|until|then|wait|no it|not really|nope|except|here's the catch|the problem|that's wrong|or so we thought)\b",
        re.IGNORECASE,
    )
    short_pivot = (len(lines[0]) < 80 and len(lines[1]) < 100 and lines[0][-1] in ".!?")
    has_signal = any(contradiction_signals.search(l) for l in lines[:3])
    has = short_pivot or has_signal
    return {
        "id": "P2",
        "name": "Two-line contradiction hook",
        "pass": has,
        "fix": None if has else "Tighten the opening to two crisp sentences with a contradiction. Pattern: <fact>. <subverting fact>. Optional 3rd line: <stakes>.",
    }


def check_p3(text: str) -> dict:
    """Story arc, not a Step 1/2/3 listicle."""
    matches = LISTICLE_RE.findall(text)
    has = len(matches) <= 2  # one or two is OK if the post is a teardown
    return {
        "id": "P3",
        "name": "Story arc, not a listicle",
        "pass": has,
        "fix": None if has else f"Found {len(matches)} listicle-style markers (e.g. 'Step 1', 'Tip 3'). Reframe as a single narrative — case → diagnosis → fix → number.",
    }


def check_p4(text: str) -> dict:
    """At least 2 concrete metric before/after numbers."""
    metrics = METRIC_RE.findall(text)
    has = len(metrics) >= 2
    return {
        "id": "P4",
        "name": "Two before/after numbers",
        "pass": has,
        "fix": None if has else f"Need at least 2 concrete metrics (CVR, ACoS, %, ×). Found {len(metrics)}. Add a before/after pair, e.g. 'ACoS 41% → 28%' or 'CVR 4.8% → 10.2%'.",
    }


def check_p5(text: str, expected_keyword: str | None = None) -> dict:
    m = CTA_RE.search(text)
    found_kw = next((g for g in (m.groups() if m else ()) if g), None) if m else None
    has = bool(m)
    if has and expected_keyword:
        if (found_kw or "").upper() != expected_keyword.upper():
            return {
                "id": "P5", "name": "Lead-magnet CTA keyword", "pass": False,
                "fix": f"Found CTA keyword '{found_kw}' but the angle expected '{expected_keyword}'. Use the angle's CTA keyword.",
            }
    return {
        "id": "P5",
        "name": "Lead-magnet CTA keyword",
        "pass": has,
        "fix": None if has else f"Add a lead-magnet CTA at the end. Pattern: 'Comment {expected_keyword or 'KEYWORD'} and I'll send <asset>.' No live link.",
    }


def check_p6(text: str) -> dict:
    """Internal vocabulary — bonus pattern. Look for a named concept introduced
    with quotes, a definition, or capitalization (e.g. 'internal cannibalization')."""
    # Heuristic: any 2-4 word phrase introduced with "called", "we call", or in quotes
    has = bool(re.search(
        r"(?:called|we call (?:it|this)|known as|named)\s+[\"']?[A-Za-z][\w\s-]{3,40}[\"']?|"
        r"\b(?:the|a)\s+[A-Z][a-z]+(?:[- ][A-Z][a-z]+){1,3}\b",
        text,
    ))
    return {
        "id": "P6",
        "name": "Internal vocabulary (bonus)",
        "pass": has,
        "fix": None if has else "Optional: name the pattern you're describing (e.g. 'match-type bleed', 'the 8% threshold rule'). Gives readers a phrase to repeat.",
    }


def check_filler(text: str) -> dict:
    found = [p for p in FILLER_PHRASES if p.lower() in text.lower()]
    return {
        "id": "VOICE",
        "name": "Filler / generic phrases",
        "pass": not found,
        "fix": None if not found else f"Filler detected: {found}. Strip these. No LinkedIn-platitude phrases.",
    }


def check_humanized(text: str) -> dict:
    """No em-dashes, no markdown bold/italic, no trailing hashtag blocks.

    Locked 2026-05-04. Labib's punctuation rules. AI-tell characters that
    LinkedIn readers spot in seconds.
    """
    em_dashes = EM_DASH_RE.findall(text)
    bold = MARKDOWN_BOLD_RE.findall(text)
    italic = MARKDOWN_ITALIC_RE.findall(text)
    hashtag_block = HASHTAG_BLOCK_RE.search(text)

    issues = []
    if em_dashes:
        issues.append(f"{len(em_dashes)} em-dash(es) found. Replace with a period, comma, or 'and'.")
    if bold:
        issues.append(f"{len(bold)} markdown bold (**text**) found: {bold[:3]}. Restructure the sentence to make the point land. LinkedIn doesn't render markdown.")
    if italic:
        issues.append(f"{len(italic)} markdown italic (*text*) found: {italic[:3]}. Drop the asterisks.")
    if hashtag_block:
        issues.append("Trailing hashtag block detected. Modern winners use zero hashtags. Remove.")

    return {
        "id": "VOICE_HUMANIZED",
        "name": "No AI tells (em-dash / markdown / hashtag dump)",
        "pass": not issues,
        "fix": None if not issues else " ".join(issues),
    }


def grade(text: str, expected_keyword: str | None = None) -> dict:
    checks = [
        check_p1(text),
        check_p2(text),
        check_p3(text),
        check_p4(text),
        check_p5(text, expected_keyword),
        check_p6(text),
        check_filler(text),
        check_humanized(text),
    ]
    required = [c for c in checks if c["id"] in ("P1", "P2", "P3", "P4", "P5", "VOICE", "VOICE_HUMANIZED")]
    passed = sum(1 for c in required if c["pass"])
    total = len(required)
    return {
        "score": f"{passed}/{total}",
        "verdict": (
            "ship-ready" if passed == total
            else "revise-once" if passed >= total - 1
            else "rewrite"
        ),
        "checks": checks,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--draft", help="Path to draft markdown file")
    ap.add_argument("--text", help="Inline post text (alternative to --draft)")
    ap.add_argument("--cta-keyword", help="Expected CTA keyword from the angle")
    args = ap.parse_args()

    if args.draft:
        text = Path(args.draft).read_text()
    elif args.text:
        text = args.text
    else:
        sys.exit("Either --draft or --text is required.")

    # Strip front-matter if present
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            text = parts[2]

    result = grade(text, args.cta_keyword)
    print(json.dumps(result, indent=2))

    # Exit non-zero if it's "rewrite" so workflows can branch on it
    if result["verdict"] == "rewrite":
        sys.exit(2)


if __name__ == "__main__":
    main()
