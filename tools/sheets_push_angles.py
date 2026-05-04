"""Push content angles from a markdown file into the Sheet's `angles` tab.

Parses §3 of `temp/outputs/content_angles_*.md` (the "Ten fresh angles" section).
Each angle keys off `### Angle N — title` heading + labeled fields
(`**Inherits:**`, `**Gap filled:**`, `**Format:**`, `**CTA keyword:**`,
`**Hook draft:**`). All other fields parsed best-effort.

Dedupes against existing rows by hook hash (normalize: lowercase + first 60
alphanumeric chars). Use --allow-duplicates to override.

Run: python3 tools/sheets_push_angles.py --source <path> [--week 2026-W18]
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import date
from pathlib import Path

from sheets_client import SCHEMA, header_map, worksheet


# Match against the angle TITLE only (not the body) — reduces false positives.
# Body-text keyword matching was too leaky: "image" appears in format fields,
# "agency" appears whenever an angle references "the previous agency", etc.
PILLAR_HINTS = {
    "Agency Founder": ["founder", "pakistan", "team", "i run", "remote", "canadian", "hiring"],
    "Conversion Lab": ["listing", "a+ ", "aplus", "cvr ", "conversion", "image", "creative", "review"],
    "PPC Operator": [],  # default
}

FORMAT_MAP = {
    "carousel": "carousel",
    "text": "text",
    "image": "image",
    "video": "video",
    "poll": "poll",
}


def normalize_hook(hook: str) -> str:
    """Hook hash for dedupe — lowercase, first 60 alphanumeric chars."""
    s = re.sub(r"[^a-z0-9]+", "", hook.lower())
    return s[:60]


def detect_pillar(title: str, body: str) -> str:
    """Match TITLE first (strong signal). Fall back to body only if title is generic."""
    title_l = title.lower()
    for pillar, hints in PILLAR_HINTS.items():
        if any(h in title_l for h in hints):
            return pillar
    # Title was generic — fall back to body, but pillar guesses on body alone
    # are unreliable. User will fix in the Sheet via the pillar dropdown.
    return "PPC Operator"


def detect_format(format_field: str) -> str:
    s = format_field.lower()
    for key in ("carousel", "video", "poll", "image", "text"):
        if key in s:
            return FORMAT_MAP[key]
    return "text"


def extract_cta(cta_field: str) -> str:
    """Pull the first backticked TOKEN or all-caps word from a CTA field."""
    m = re.search(r"`([A-Z][A-Z0-9_-]*)`", cta_field)
    if m:
        return m.group(1)
    if "none" in cta_field.lower() or "no lead magnet" in cta_field.lower():
        return ""
    m = re.search(r"\b([A-Z]{3,})\b", cta_field)
    return m.group(1) if m else ""


def parse_angles(md: str) -> list[dict]:
    """Walk the markdown and yield angle dicts."""
    # Match angles by `### Angle N — title` heading, capture everything until
    # the next `### ` or `## ` heading or end of file
    pattern = re.compile(
        r"^###\s+Angle\s+(\d+)\s*[—-]+\s*(.+?)\n(.*?)(?=^###\s|^##\s|\Z)",
        re.MULTILINE | re.DOTALL,
    )
    angles: list[dict] = []

    for m in pattern.finditer(md):
        num = int(m.group(1))
        title = m.group(2).strip()
        body = m.group(3)

        def field(name: str) -> str:
            fm = re.search(
                rf"\*\*{re.escape(name)}:\*\*\s*(.+?)(?=\n\*\*[A-Z]|\Z)",
                body,
                re.DOTALL,
            )
            return fm.group(1).strip() if fm else ""

        inherits = field("Inherits")
        gap = field("Gap filled") or field("Source")
        fmt = field("Format")
        cta = field("CTA keyword")
        hook = field("Hook draft")

        # Strip blockquote markers from hook
        hook_clean = re.sub(r"^>\s?", "", hook, flags=re.MULTILINE).strip()

        # Pull P-codes out of the inherits field
        patterns = re.findall(r"\bP\d\b", inherits)

        angles.append({
            "num": num,
            "title": title,
            "pillar": detect_pillar(title, body),
            "format": detect_format(fmt),
            "hook_seed": hook_clean[:500],
            "cta_keyword": extract_cta(cta),
            "winner_patterns": ", ".join(patterns),
            "gap_filled": gap[:200],
        })

    return angles


def existing_hashes(ws, hm: dict[str, int]) -> set[str]:
    """Return the set of normalized hook hashes already in the sheet.

    Reads hook_seed (the new column name); falls back to legacy hook_draft if
    a pre-migration sheet is in play."""
    hook_col = hm.get("hook_seed") or hm.get("hook_draft")
    if not hook_col:
        return set()
    values = ws.col_values(hook_col)[1:]  # skip header
    return {normalize_hook(v) for v in values if v}


def next_index(ws, hm: dict[str, int], week: str) -> int:
    """Return the next A-index for this week (so re-runs don't collide)."""
    id_col = hm.get("angle_id")
    if not id_col:
        return 1
    ids = ws.col_values(id_col)[1:]
    nums = []
    prefix = f"{week}-A"
    for v in ids:
        if v.startswith(prefix):
            try:
                nums.append(int(v[len(prefix):]))
            except ValueError:
                pass
    return max(nums) + 1 if nums else 1


def iso_week_today() -> str:
    today = date.today()
    iso_year, iso_week, _ = today.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="Path to angle markdown file")
    ap.add_argument("--week", default=None, help="ISO week label (default: current)")
    ap.add_argument("--allow-duplicates", action="store_true")
    args = ap.parse_args()

    md_path = Path(args.source).resolve()
    if not md_path.exists():
        sys.exit(f"Source file not found: {md_path}")

    week = args.week or iso_week_today()
    md = md_path.read_text()
    parsed = parse_angles(md)
    if not parsed:
        sys.exit(f"No angles parsed from {md_path}. Check the heading format (### Angle N — title).")

    print(f"Parsed {len(parsed)} angles from {md_path.name}", file=sys.stderr)

    ws = worksheet("angles")
    hm = header_map(ws)
    existing = set() if args.allow_duplicates else existing_hashes(ws, hm)
    start_idx = next_index(ws, hm, week)
    today = date.today().isoformat()

    rows_to_append: list[list[str]] = []
    skipped: list[str] = []
    pushed_ids: list[str] = []
    headers = SCHEMA["angles"]

    for offset, a in enumerate(parsed):
        h = normalize_hook(a["hook_seed"])
        if h and h in existing:
            skipped.append(f"#{a['num']} {a['title'][:60]}")
            continue
        angle_id = f"{week}-A{start_idx + len(rows_to_append):02d}"
        row_data = {
            "angle_id": angle_id,
            "status": "Pending",
            "pillar": a["pillar"],
            "format": a["format"],
            "hook_seed": a["hook_seed"],
            "cta_keyword": a["cta_keyword"],
            "winner_patterns": a["winner_patterns"],
            "gap_filled": a["gap_filled"],
            "week_assigned": "",
            "notes": "",
            "date_generated": today,
            "date_approved": "",
            "date_posted": "",
            "post_url": "",
            "hook_chosen": "",
            "hook_alternates": "",
            "draft_body": "",
            "critic_score": "",
            "slide_outline": "",
            "source_md": f"{md_path.name}#angle-{a['num']}",
        }
        rows_to_append.append([row_data[col] for col in headers])
        pushed_ids.append(angle_id)
        existing.add(h)

    if rows_to_append:
        ws.append_rows(rows_to_append, value_input_option="USER_ENTERED")

    print("\nPUSH COMPLETE")
    print(f"  pushed:  {len(pushed_ids)}")
    print(f"  skipped: {len(skipped)} (duplicate hook)")
    if pushed_ids:
        print(f"  IDs:     {', '.join(pushed_ids)}")
    for s in skipped:
        print(f"  - skipped: {s}")
    print(f"\nSheet URL: https://docs.google.com/spreadsheets/d/{ws.spreadsheet.id}/edit")


if __name__ == "__main__":
    main()
