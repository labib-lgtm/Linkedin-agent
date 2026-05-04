"""Read a Drafted angle's full record from the Sheet — used by 07_publish.

Returns JSON with all columns (most importantly draft_body) so the publisher
can hand the body straight to Unipile without touching disk.

If the draft_body is empty, exit non-zero so callers can halt cleanly.

Run:
  python3 tools/sheets_read_draft.py --angle-id 2026-W18-A09
  python3 tools/sheets_read_draft.py --angle-id 2026-W18-A09 --body-only
"""
from __future__ import annotations

import argparse
import json
import sys

from sheets_client import header_map, worksheet


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--body-only", action="store_true",
                    help="Print just the draft_body to stdout (no JSON wrapper)")
    args = ap.parse_args()

    ws = worksheet("angles")
    header_map(ws)  # validates schema, fails loud on drift
    rows = ws.get_all_records()
    found: dict | None = None
    for r in rows:
        if str(r.get("angle_id", "")).strip() == args.angle_id:
            found = r
            break
    if not found:
        sys.exit(f"angle_id not found: {args.angle_id}")

    body = str(found.get("draft_body", "")).strip()
    if not body:
        sys.exit(
            f"angle {args.angle_id} has no draft_body. "
            f"Status: {found.get('status', '?')}. "
            f"Run 04_post_writer first."
        )

    if args.body_only:
        sys.stdout.write(body)
        return

    out = {
        "angle_id": found.get("angle_id", ""),
        "status": found.get("status", ""),
        "pillar": found.get("pillar", ""),
        "format": found.get("format", ""),
        "cta_keyword": found.get("cta_keyword", ""),
        "hook_chosen": found.get("hook_chosen", ""),
        "hook_alternates": found.get("hook_alternates", ""),
        "draft_body": body,
        "critic_score": found.get("critic_score", ""),
        "slide_outline": found.get("slide_outline", ""),
        "post_url": found.get("post_url", ""),
        "draft_body_length": len(body),
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
