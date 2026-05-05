"""Append a metrics row to the `metrics` table.

Called by 09_performance_review after Unipile metrics are pulled.
Append-only — multiple rows per angle accumulate as a time series.

Run:
  python3 tools/sheets_write_metrics.py --angle-id <id> \
      --impressions N --reactions N --comments N --reposts N \
      [--saves N --sends N --dwell-ratio F --verdict winner|loser|median]

  python3 tools/sheets_write_metrics.py --from-published 2026-W18
      (bulk-pull all Posted rows for a week and append metrics from Unipile)

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now writes to Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from supabase_client import client, insert_row, read_angles


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def bulk_from_published(week: str) -> None:
    """For every Posted angle in the given week, pull metrics from Unipile and append."""
    res = (
        client()
        .table("angles")
        .select("*")
        .eq("status", "Posted")
        .eq("week_assigned", week)
        .execute()
    )
    targets = [r for r in (res.data or []) if str(r.get("post_url") or "").strip()]
    if not targets:
        print(f"No Posted angles for week {week}", file=sys.stderr)
        return

    project_root = Path(__file__).resolve().parent.parent
    raw_path = project_root / "temp" / "resources" / "my_posts_raw.json"
    if not raw_path.exists():
        sys.exit(f"Need {raw_path}. Run: python3 tools/unipile_get_my_posts.py first.")

    raw = json.loads(raw_path.read_text())
    by_url = {p.get("share_url", "").split("?")[0]: p for p in raw.get("posts", [])}

    appended = 0
    for r in targets:
        url = str(r.get("post_url") or "").strip().split("?")[0]
        p = by_url.get(url)
        if not p:
            print(f"  no Unipile data for {r['angle_id']} ({url})", file=sys.stderr)
            continue
        insert_row("metrics", {
            "angle_id":    r["angle_id"],
            "post_url":    url,
            "impressions": p.get("impressions_counter") or None,
            "reactions":   p.get("reaction_counter") or None,
            "comments":    p.get("comment_counter") or None,
            "reposts":     p.get("repost_counter") or None,
            "pulled_at":   now_iso(),
        })
        appended += 1
        print(
            f"  + {r['angle_id']}: imp={p.get('impressions_counter')} "
            f"rxn={p.get('reaction_counter')} cmt={p.get('comment_counter')}",
            file=sys.stderr,
        )

    print(f"\nMETRICS APPENDED: {appended}/{len(targets)}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id")
    ap.add_argument("--post-url", default="")
    ap.add_argument("--impressions", type=int)
    ap.add_argument("--reactions", type=int)
    ap.add_argument("--comments", type=int)
    ap.add_argument("--reposts", type=int)
    ap.add_argument("--saves", type=int)
    ap.add_argument("--sends", type=int)
    ap.add_argument("--dwell-ratio", type=float)
    ap.add_argument("--verdict", choices=["winner", "loser", "median"])
    ap.add_argument(
        "--from-published",
        help="ISO week, e.g. 2026-W18 — bulk pull all Posted angles",
    )
    args = ap.parse_args()

    if args.from_published:
        bulk_from_published(args.from_published)
        return

    if not args.angle_id:
        sys.exit("Either --angle-id (single) or --from-published <week> (bulk) is required.")

    fields = {
        "angle_id":    args.angle_id,
        "post_url":    args.post_url or None,
        "impressions": args.impressions,
        "reactions":   args.reactions,
        "comments":    args.comments,
        "reposts":     args.reposts,
        "saves":       args.saves,
        "sends":       args.sends,
        "dwell_ratio": args.dwell_ratio,
        "verdict":     args.verdict,
        "pulled_at":   now_iso(),
    }
    insert_row("metrics", {k: v for k, v in fields.items() if v is not None})
    print(f"OK — appended metrics row for {args.angle_id}")


if __name__ == "__main__":
    main()
