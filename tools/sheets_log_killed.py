"""Log a killed angle to killed_topics + flip its angles row to Killed.

Use when the user marks an angle 'Killed' — propagates to the dedupe table
so 03_topic_pipeline doesn't regenerate the same idea later.

Run: python3 tools/sheets_log_killed.py --angle-id <id> --reason <text>

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now writes to Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

from supabase_client import (
    client, get_angle, insert_row, update_angle,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--reason", required=True, help="Why was this killed?")
    args = ap.parse_args()

    angle = get_angle(args.angle_id)
    if angle is None:
        sys.exit(f"angle_id not found: {args.angle_id}")

    summary = (
        str(angle.get("hook_seed") or "")
        or str(angle.get("hook_chosen") or "")
        or str(angle.get("gap_filled") or "")
    )[:160]

    # Pick the next K### id (count existing rows + 1).
    res = client().table("killed_topics").select("killed_id").execute()
    next_n = len(res.data or []) + 1
    killed_id = f"K{next_n:03d}"

    insert_row("killed_topics", {
        "killed_id":       killed_id,
        "topic_summary":   summary,
        "reason":          args.reason,
        "date_killed":     datetime.now(timezone.utc).isoformat(),
        "source_angle_id": args.angle_id,
    })

    # Flip angle row to Killed (in case caller invokes directly without UI edit).
    update_angle(args.angle_id, {"status": "Killed"})

    print(f"OK — {args.angle_id} → Killed, logged as {killed_id}")


if __name__ == "__main__":
    main()
