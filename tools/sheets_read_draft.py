"""Read a Drafted angle's full record — used by 07_publish.

Returns JSON with all columns (most importantly draft_body) so the publisher
can hand the body straight to Unipile without touching disk.

If the draft_body is empty, exit non-zero so callers can halt cleanly.

Run:
  python3 tools/sheets_read_draft.py --angle-id 2026-W18-A09
  python3 tools/sheets_read_draft.py --angle-id 2026-W18-A09 --body-only

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now reads from Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import json
import sys

from supabase_client import get_angle


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument(
        "--body-only",
        action="store_true",
        help="Print just the draft_body to stdout (no JSON wrapper).",
    )
    args = ap.parse_args()

    found = get_angle(args.angle_id)
    if not found:
        sys.exit(f"angle_id not found: {args.angle_id}")

    body = str(found.get("draft_body") or "").strip()
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
        "angle_id":          found.get("angle_id", ""),
        "status":            found.get("status", ""),
        "pillar":            found.get("pillar", ""),
        "format":            found.get("format", ""),
        "cta_keyword":       found.get("cta_keyword", ""),
        "hook_chosen":       found.get("hook_chosen", ""),
        "hook_alternates":   found.get("hook_alternates", ""),
        "draft_body":        body,
        "critic_score":      found.get("critic_score", ""),
        "slide_outline":     found.get("slide_outline", ""),
        "post_url":          found.get("post_url", ""),
        "asset_path":        found.get("asset_path", ""),
        "image_size":        found.get("image_size", ""),
        "lead_magnet_path":  found.get("lead_magnet_path", ""),
        "lead_magnet_url":   found.get("lead_magnet_url", ""),
        "draft_body_length": len(body),
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
