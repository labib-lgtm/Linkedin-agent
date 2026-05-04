"""Log a killed angle to the killed_topics tab + flip its angles row to Killed.

Use when the user marks an angle 'Killed' in the Sheet — propagates to the
dedupe table so 03_topic_pipeline doesn't regenerate the same idea later.

Run: python3 tools/sheets_log_killed.py --angle-id <id> --reason <text>
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from sheets_client import (
    SCHEMA, find_row_by_id, header_map, safe_update, worksheet, col_letter,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--reason", required=True, help="Why was this killed?")
    args = ap.parse_args()

    angles_ws = worksheet("angles")
    hm = header_map(angles_ws)
    row = find_row_by_id(angles_ws, args.angle_id, id_col=hm["angle_id"])
    if row is None:
        sys.exit(f"angle_id not found in angles tab: {args.angle_id}")

    record = angles_ws.row_values(row)
    by_col = {SCHEMA["angles"][i]: record[i] if i < len(record) else "" for i in range(len(SCHEMA["angles"]))}
    summary = (by_col.get("hook_seed") or by_col.get("hook_draft") or by_col.get("gap_filled") or "")[:160]

    killed_ws = worksheet("killed_topics")
    killed_headers = SCHEMA["killed_topics"]
    existing_ids = killed_ws.col_values(1)[1:]
    next_n = len(existing_ids) + 1
    killed_id = f"K{next_n:03d}"
    today = date.today().isoformat()

    killed_row = {
        "killed_id": killed_id,
        "topic_summary": summary,
        "reason": args.reason,
        "date_killed": today,
        "source_angle_id": args.angle_id,
    }
    killed_ws.append_row([killed_row[c] for c in killed_headers], value_input_option="USER_ENTERED")

    # Flip angles row to Killed (in case caller invokes directly without UI edit)
    safe_update(angles_ws, [
        {"range": f"{col_letter(hm['status'])}{row}", "values": [["Killed"]]},
    ])

    print(f"OK — {args.angle_id} → Killed, logged as {killed_id}")


if __name__ == "__main__":
    main()
