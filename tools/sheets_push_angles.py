"""Push content angles from a markdown file into the `angles` table.

Parses §3 of `temp/outputs/content_angles_*.md` (the "Ten fresh angles" section).
Each angle keys off `### Angle N — title` heading + labeled fields
(`**Inherits:**`, `**Gap filled:**`, `**Format:**`, `**CTA keyword:**`,
`**Hook draft:**`). All other fields parsed best-effort.

Dedupes against existing rows by hook hash (normalize: lowercase + first 60
alphanumeric chars). Use --allow-duplicates to override.

Run: python3 tools/sheets_push_angles.py --source <path> [--week 2026-W18]

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now writes to Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from supabase_client import client, insert_row

# Match against the angle TITLE only (not the body) — reduces false positives.
PILLAR_HINTS = {
    "Agency Founder": ["founder", "pakistan", "team", "i run", "remote", "canadian", "hiring"],
    "Conversion Lab": ["listing", "a+ ", "aplus", "cvr ", "conversion", "image", "creative", "review"],
    "PPC Operator": [],  # default
}

FORMAT_MAP = {
    "carousel": "carousel",
    "text":     "text",
    "image":    "image",
    "video":    "video",
    "poll":     "poll",
}


def normalize_hook(hook: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "", hook.lower())
    return s[:60]


def detect_pillar(title: str, body: str) -> str:
    title_l = title.lower()
    for pillar, hints in PILLAR_HINTS.items():
        if any(h in title_l for h in hints):
            return pillar
    return "PPC Operator"


def detect_format(format_field: str) -> str:
    s = format_field.lower()
    for key in ("carousel", "video", "poll", "image", "text"):
        if key in s:
            return FORMAT_MAP[key]
    return "text"


def extract_cta(cta_field: str) -> str:
    m = re.search(r"`([A-Z][A-Z0-9_-]*)`", cta_field)
    if m:
        return m.group(1)
    if "none" in cta_field.lower() or "no lead magnet" in cta_field.lower():
        return ""
    m = re.search(r"\b([A-Z]{3,})\b", cta_field)
    return m.group(1) if m else ""


def parse_angles(md: str) -> list[dict]:
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
        hook_clean = re.sub(r"^>\s?", "", hook, flags=re.MULTILINE).strip()
        patterns = re.findall(r"\bP\d\b", inherits)

        angles.append({
            "num":             num,
            "title":           title,
            "pillar":          detect_pillar(title, body),
            "format":          detect_format(fmt),
            "hook_seed":       hook_clean[:500],
            "cta_keyword":     extract_cta(cta),
            "winner_patterns": ", ".join(patterns),
            "gap_filled":      gap[:200],
        })
    return angles


def existing_hashes() -> set[str]:
    """Return the set of normalized hook hashes already in Supabase."""
    res = client().table("angles").select("hook_seed").execute()
    rows = res.data or []
    return {normalize_hook(str(r.get("hook_seed") or "")) for r in rows if r.get("hook_seed")}


def next_index(week: str) -> int:
    """Return the next A-index for this week (so re-runs don't collide)."""
    res = client().table("angles").select("angle_id").like("angle_id", f"{week}-A%").execute()
    nums: list[int] = []
    prefix = f"{week}-A"
    for r in (res.data or []):
        v = str(r.get("angle_id") or "")
        if v.startswith(prefix):
            try:
                nums.append(int(v[len(prefix):]))
            except ValueError:
                pass
    return max(nums) + 1 if nums else 1


def iso_week_today() -> str:
    today = datetime.now(timezone.utc).date()
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
        sys.exit(
            f"No angles parsed from {md_path}. "
            f"Check the heading format (### Angle N — title)."
        )

    print(f"Parsed {len(parsed)} angles from {md_path.name}", file=sys.stderr)

    existing = set() if args.allow_duplicates else existing_hashes()
    start_idx = next_index(week)
    now_iso = datetime.now(timezone.utc).isoformat()

    pushed_ids: list[str] = []
    skipped: list[str] = []

    for a in parsed:
        h = normalize_hook(a["hook_seed"])
        if h and h in existing:
            skipped.append(f"#{a['num']} {a['title'][:60]}")
            continue
        angle_id = f"{week}-A{start_idx + len(pushed_ids):02d}"
        insert_row("angles", {
            "angle_id":        angle_id,
            "status":          "Pending",
            "pillar":          a["pillar"],
            "format":          a["format"],
            "hook_seed":       a["hook_seed"],
            "cta_keyword":     a["cta_keyword"] or None,
            "winner_patterns": a["winner_patterns"],
            "gap_filled":      a["gap_filled"],
            "date_generated":  now_iso,
            "source_md":       f"{md_path.name}#angle-{a['num']}",
        })
        pushed_ids.append(angle_id)
        existing.add(h)

    print("\nPUSH COMPLETE")
    print(f"  pushed:  {len(pushed_ids)}")
    print(f"  skipped: {len(skipped)} (duplicate hook)")
    if pushed_ids:
        print(f"  IDs:     {', '.join(pushed_ids)}")
    for s in skipped:
        print(f"  - skipped: {s}")


if __name__ == "__main__":
    main()
