"""Read approved angles from the Sheet — the actual approval gate.

Returns JSON of rows where status = Approved AND draft_body = "".
On match: atomically flips status → Drafting and stamps date_approved if empty.
That makes re-runs idempotent: an angle being drafted won't be picked up twice.

`--count-pending` mode: returns counts only, no state change. Used by 04_post_writer
to ask "want me to run 03 to generate more?".

Run:
  python3 tools/sheets_read_approved.py [--limit N]
  python3 tools/sheets_read_approved.py --count-pending
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date

from sheets_client import SCHEMA, header_map, safe_update, worksheet, col_letter


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10, help="Max rows to return (default 10)")
    ap.add_argument("--count-pending", action="store_true", help="Return counts only")
    ap.add_argument("--no-flip", action="store_true", help="Don't flip status to Drafting")
    args = ap.parse_args()

    ws = worksheet("angles")
    hm = header_map(ws)
    rows = ws.get_all_records()  # list[dict] keyed by header

    if args.count_pending:
        pending = sum(1 for r in rows if str(r.get("status", "")).strip().lower() == "pending")
        approved_unwritten = sum(
            1 for r in rows
            if str(r.get("status", "")).strip().lower() == "approved"
            and not str(r.get("draft_body", "")).strip()
        )
        approved_total = sum(1 for r in rows if str(r.get("status", "")).strip().lower() == "approved")
        print(json.dumps({
            "pending": pending,
            "approved_unwritten": approved_unwritten,
            "approved_total": approved_total,
        }))
        return

    matched: list[dict] = []
    updates: list[dict] = []
    today = date.today().isoformat()

    status_col = hm["status"]
    date_approved_col = hm["date_approved"]

    for i, r in enumerate(rows, start=2):  # row 1 is header, data starts at 2
        status = str(r.get("status", "")).strip().lower()
        draft_body = str(r.get("draft_body", "")).strip()
        if status != "approved" or draft_body:
            continue
        matched.append({
            "row": i,
            "angle_id": r.get("angle_id", ""),
            "pillar": r.get("pillar", ""),
            "format": r.get("format", ""),
            "hook_seed": r.get("hook_seed", "") or r.get("hook_draft", ""),
            "cta_keyword": r.get("cta_keyword", ""),
            "winner_patterns": r.get("winner_patterns", ""),
            "gap_filled": r.get("gap_filled", ""),
            "notes": r.get("notes", ""),
            "source_md": r.get("source_md", ""),
        })
        if len(matched) >= args.limit:
            break

    if matched and not args.no_flip:
        for m in matched:
            updates.append({
                "range": f"{col_letter(status_col)}{m['row']}",
                "values": [["Drafting"]],
            })
            if not str(rows[m["row"] - 2].get("date_approved", "")).strip():
                updates.append({
                    "range": f"{col_letter(date_approved_col)}{m['row']}",
                    "values": [[today]],
                })
        safe_update(ws, updates)

    # Strip the row index from output — caller doesn't need it
    out = [{k: v for k, v in m.items() if k != "row"} for m in matched]
    print(json.dumps({"count": len(out), "angles": out}, indent=2))


if __name__ == "__main__":
    main()
