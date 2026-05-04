"""Flip an angle's status to Posted, stamp date_posted and post_url.

Called by 07_publish.md after Unipile confirms the post is live.
If this fails, 07_publish should still write to temp/outputs/published/YYYY-WW.md
so we never lose a publish record — this is just the Sheet-side mirror.

Run: python3 tools/sheets_mark_posted.py --angle-id <id> --post-url <url>
"""
from __future__ import annotations

import argparse
import sys
from datetime import date

from sheets_client import find_row_by_id, header_map, safe_update, worksheet, col_letter


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--post-url", required=True)
    args = ap.parse_args()

    ws = worksheet("angles")
    hm = header_map(ws)
    row = find_row_by_id(ws, args.angle_id, id_col=hm["angle_id"])
    if row is None:
        sys.exit(f"angle_id not found: {args.angle_id}")

    today = date.today().isoformat()
    updates = [
        {"range": f"{col_letter(hm['status'])}{row}", "values": [["Posted"]]},
        {"range": f"{col_letter(hm['date_posted'])}{row}", "values": [[today]]},
        {"range": f"{col_letter(hm['post_url'])}{row}", "values": [[args.post_url]]},
    ]
    safe_update(ws, updates)
    print(f"OK — {args.angle_id} → Posted, date={today}, url={args.post_url}")


if __name__ == "__main__":
    main()
