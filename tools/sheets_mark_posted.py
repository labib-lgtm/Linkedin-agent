"""Flip an angle's status to Posted, stamp date_posted and post_url.

Called by 07_publish.md after Unipile confirms the post is live.
If this fails, 07_publish should still write the published audit row locally
so we never lose a publish record — this is just the canonical-store mirror.

Run: python3 tools/sheets_mark_posted.py --angle-id <id> --post-url <url>

Filename kept (sheets_*) for compatibility with existing workflow doc commands;
the implementation now writes to Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone

from supabase_client import update_angle


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--post-url", required=True)
    args = ap.parse_args()

    now_iso = datetime.now(timezone.utc).isoformat()
    update_angle(
        args.angle_id,
        {
            "status":      "Posted",
            "date_posted": now_iso,
            "post_url":    args.post_url,
        },
    )
    print(f"OK — {args.angle_id} → Posted, date={now_iso}, url={args.post_url}")


if __name__ == "__main__":
    main()
