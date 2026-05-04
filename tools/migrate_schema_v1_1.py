"""One-shot schema migration v1 → v1.1: Sheet-canonical drafts.

What changes:
  - Column E: hook_draft → hook_seed (rename only, value preserved)
  - Column O: was draft_path → now hook_chosen (cleared, draft_path discarded)
  - Column P: was source_md → now hook_alternates (cleared)
  - Cols Q, R, S: NEW (draft_body, critic_score, slide_outline)
  - Column T: NEW location for source_md (value moved from old col P)

Plus: backfills A09's draft fields from the existing markdown file.

Idempotent: safe to re-run. Detects whether migration is already complete and
exits cleanly.

Run: python3 tools/migrate_schema_v1_1.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from sheets_client import SCHEMA, sheet, worksheet, col_letter, safe_update

PROJECT_ROOT = Path(__file__).resolve().parent.parent
A09_DRAFT = PROJECT_ROOT / "temp" / "outputs" / "drafts" / "2026-W18" / "prime-day-8-week-countdown.md"

NEW_HEADERS = SCHEMA["angles"]
OLD_HEADERS_V1 = [
    "angle_id", "status", "pillar", "format", "hook_draft", "cta_keyword",
    "winner_patterns", "gap_filled", "week_assigned", "notes",
    "date_generated", "date_approved", "date_posted", "post_url",
    "draft_path", "source_md",
]


def detect_state(ws) -> str:
    actual = [h.strip() for h in ws.row_values(1) if h.strip()]
    if actual == NEW_HEADERS:
        return "v1.1"
    if actual == OLD_HEADERS_V1:
        return "v1"
    return "drift"


def parse_a09_draft() -> dict:
    """Pull the hook variants + body + slide outline from the markdown file."""
    if not A09_DRAFT.exists():
        sys.exit(f"A09 draft not found: {A09_DRAFT}")
    md = A09_DRAFT.read_text()

    def section(title: str) -> str:
        m = re.search(
            rf"###\s+{re.escape(title)}.*?\n(.*?)(?=^###\s|^---|\Z)",
            md, re.DOTALL | re.MULTILINE,
        )
        if not m:
            return ""
        text = m.group(1).strip()
        # Strip blockquote markers
        return re.sub(r"^>\s?", "", text, flags=re.MULTILINE).strip()

    hook_a = section('Hook A — "specific number + outcome" (W1/W3 style)')
    hook_b = section('Hook B — "two-line contradiction" (W2/W4 style) ← chosen primary')
    hook_c = section('Hook C — "uncomfortable claim"')

    # Body lives under "## Body" header until the next "---"
    body_match = re.search(
        r"^##\s+Body[^\n]*\n+(.*?)(?=^---)",
        md, re.DOTALL | re.MULTILINE,
    )
    body = body_match.group(1).strip() if body_match else ""

    # Slide outline lives under "## Slide outline preview"
    outline_match = re.search(
        r"^##\s+Slide outline preview[^\n]*\n+(.*?)(?=^---)",
        md, re.DOTALL | re.MULTILINE,
    )
    outline_raw = outline_match.group(1).strip() if outline_match else ""
    # Pipe-join the slide lines for single-cell readability
    slide_lines = [
        re.sub(r"^\d+\.\s*", "", l.strip())
        for l in outline_raw.splitlines()
        if l.strip() and re.match(r"^\d+\.\s+", l.strip())
    ]
    slide_outline = " ||| ".join(slide_lines)

    alternates = f"Hook A ||| {hook_a}\n\nHook C ||| {hook_c}".strip()

    return {
        "hook_chosen": "B",
        "hook_alternates": alternates,
        "draft_body": body,
        "critic_score": "6/6 ship-ready",
        "slide_outline": slide_outline,
    }


def migrate(ws) -> None:
    """Migrate from v1 → v1.1."""
    state = detect_state(ws)
    if state == "v1.1":
        print("Schema already at v1.1 — nothing to migrate.")
        return
    if state == "drift":
        actual = ws.row_values(1)
        sys.exit(
            f"Schema drift — neither v1 nor v1.1. Expected v1 headers:\n"
            f"  {OLD_HEADERS_V1}\nGot:\n  {actual}\n"
            f"Manual fix needed."
        )

    print("Detected v1 schema. Migrating to v1.1...")

    # Snapshot the data rows (rows 2..N)
    all_values = ws.get_all_values()
    if len(all_values) <= 1:
        print("  no data rows — only headers need rewriting")
        data_rows: list[list[str]] = []
    else:
        data_rows = all_values[1:]

    # For each data row: capture old values
    # Old layout:    A:angle_id, B:status, ..., O:draft_path, P:source_md
    # New layout:    A:angle_id, ..., O:hook_chosen, P:hook_alternates,
    #                Q:draft_body, R:critic_score, S:slide_outline, T:source_md
    # Migration:     keep A-N, clear O & P, leave Q-S empty, write T = old P
    migrated_rows: list[list[str]] = []
    for r in data_rows:
        # Pad to 16 cols if short
        r = (r + [""] * 16)[:16]
        old_source_md = r[15]  # col P = index 15
        new_row = (
            r[:14]            # A-N preserved
            + ["", "", "", "", ""]  # O-S cleared (hook_chosen, hook_alternates, draft_body, critic_score, slide_outline)
            + [old_source_md]  # T: source_md
        )
        migrated_rows.append(new_row)

    # Wipe the entire data range (will rewrite below) — clear A1:T<N>
    n = len(all_values)
    last_col = col_letter(20)
    if n > 0:
        ws.batch_clear([f"A1:{last_col}{max(n, 1)}"])

    # Write new headers
    ws.update(values=[NEW_HEADERS], range_name=f"A1:{last_col}1")
    ws.freeze(rows=1)

    # Write migrated data rows back
    if migrated_rows:
        ws.update(
            values=migrated_rows,
            range_name=f"A2:{last_col}{1 + len(migrated_rows)}",
        )

    print(f"  migrated {len(migrated_rows)} data rows")
    print(f"  cleared old draft_path values (col O); preserved source_md (now col T)")


def find_row_id(ws, angle_id: str) -> int | None:
    col = ws.col_values(1)
    for i, v in enumerate(col, start=1):
        if v.strip() == angle_id:
            return i
    return None


def backfill_a09(ws) -> None:
    """Backfill A09 row from the existing markdown draft."""
    parsed = parse_a09_draft()
    row = find_row_id(ws, "2026-W18-A09")
    if row is None:
        print("A09 row not found, skipping backfill.")
        return

    # Map column names → letters via current headers (post-migration)
    headers = ws.row_values(1)
    cols = {h.strip(): col_letter(i + 1) for i, h in enumerate(headers) if h.strip()}

    updates = [
        {"range": f"{cols['status']}{row}", "values": [["Drafted"]]},
        {"range": f"{cols['hook_chosen']}{row}", "values": [[parsed["hook_chosen"]]]},
        {"range": f"{cols['hook_alternates']}{row}", "values": [[parsed["hook_alternates"]]]},
        {"range": f"{cols['draft_body']}{row}", "values": [[parsed["draft_body"]]]},
        {"range": f"{cols['critic_score']}{row}", "values": [[parsed["critic_score"]]]},
        {"range": f"{cols['slide_outline']}{row}", "values": [[parsed["slide_outline"]]]},
    ]
    safe_update(ws, updates)
    print(f"  backfilled A09 (body {len(parsed['draft_body'])} chars, "
          f"slides {parsed['slide_outline'].count('|||') + 1})")


def main() -> None:
    ws = worksheet("angles")
    print(f"Spreadsheet: {ws.spreadsheet.title} ({ws.spreadsheet.id})")
    print(f"Tab: {ws.title}")
    migrate(ws)

    # Validate post-state
    state = detect_state(ws)
    if state != "v1.1":
        sys.exit(f"Migration FAILED — post-state: {state}")
    print("Schema is v1.1.")

    # Backfill A09
    print("\nBackfilling A09 from markdown draft...")
    backfill_a09(ws)

    print("\nMIGRATION COMPLETE.")
    print(f"Sheet URL: https://docs.google.com/spreadsheets/d/{ws.spreadsheet.id}/edit")


if __name__ == "__main__":
    main()
