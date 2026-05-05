"""Read approved angles — the actual approval gate.

Returns JSON of records where status = Approved AND draft_body = "".
On match: atomically flips status → Drafting and stamps date_approved if empty.
That makes re-runs idempotent: an angle being drafted won't be picked up twice.

`--count-pending` mode: returns counts only, no state change. Used by 04_post_writer
to ask "want me to run 03 to generate more?".

Run:
  python3 tools/sheets_read_approved.py [--limit N]
  python3 tools/sheets_read_approved.py --count-pending

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now reads from Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone

from supabase_client import client, read_angles, update_angle


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=10, help="Max rows to return (default 10)")
    ap.add_argument("--count-pending", action="store_true", help="Return counts only")
    ap.add_argument("--no-flip", action="store_true", help="Don't flip status to Drafting")
    args = ap.parse_args()

    if args.count_pending:
        pending = len(read_angles(status="Pending"))
        approved_rows = read_angles(status="Approved")
        approved_unwritten = sum(
            1 for r in approved_rows
            if not str(r.get("draft_body") or "").strip()
        )
        print(json.dumps({
            "pending":            pending,
            "approved_unwritten": approved_unwritten,
            "approved_total":     len(approved_rows),
        }))
        return

    # Pull approved rows that have not been drafted yet, ordered by angle_id.
    res = (
        client()
        .table("angles")
        .select("*")
        .eq("status", "Approved")
        .order("angle_id")
        .execute()
    )
    rows = [
        r for r in (res.data or [])
        if not str(r.get("draft_body") or "").strip()
    ][: args.limit]

    matched: list[dict] = [
        {
            "angle_id":        r.get("angle_id", ""),
            "pillar":          r.get("pillar", ""),
            "format":          r.get("format", ""),
            "hook_seed":       r.get("hook_seed", ""),
            "cta_keyword":     r.get("cta_keyword", ""),
            "winner_patterns": r.get("winner_patterns", ""),
            "gap_filled":      r.get("gap_filled", ""),
            "notes":           r.get("notes", ""),
            "source_md":       r.get("source_md", ""),
            "_orig_date_approved": r.get("date_approved"),
        }
        for r in rows
    ]

    if matched and not args.no_flip:
        now_iso = datetime.now(timezone.utc).isoformat()
        for m in matched:
            fields = {"status": "Drafting"}
            if not m.pop("_orig_date_approved"):
                fields["date_approved"] = now_iso
            update_angle(m["angle_id"], fields)
    else:
        for m in matched:
            m.pop("_orig_date_approved", None)

    print(json.dumps({"count": len(matched), "angles": matched}, indent=2))


if __name__ == "__main__":
    main()
