"""Append a metrics row to the Sheet's `metrics` tab.

Called by 09_performance_review after Unipile metrics are pulled.
Append-only — multiple rows per angle accumulate as a time series.

Run:
  python3 tools/sheets_write_metrics.py --angle-id <id> \
      --impressions N --reactions N --comments N --reposts N \
      [--saves N --sends N --dwell-ratio F --verdict winner|loser|median]

  python3 tools/sheets_write_metrics.py --from-published 2026-W18
      (bulk-pull all Posted rows for a week and append metrics from Unipile)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from sheets_client import SCHEMA, header_map, worksheet


def append_one(ws, headers: list[str], data: dict) -> None:
    row = [data.get(col, "") for col in headers]
    ws.append_row(row, value_input_option="USER_ENTERED")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def bulk_from_published(week: str) -> None:
    """For every Posted angle in the given week, pull metrics from Unipile and append."""
    angles_ws = worksheet("angles")
    rows = angles_ws.get_all_records()
    targets = [
        r for r in rows
        if str(r.get("status", "")).strip().lower() == "posted"
        and str(r.get("week_assigned", "")).strip() == week
        and str(r.get("post_url", "")).strip()
    ]
    if not targets:
        print(f"No Posted angles for week {week}", file=sys.stderr)
        return

    project_root = Path(__file__).resolve().parent.parent
    pulled = json.loads(
        subprocess.check_output(
            ["python3", str(project_root / "tools" / "unipile_get_my_posts.py")],
            cwd=str(project_root),
        )
        if False  # we already have raw data on disk; re-using it
        else "{}"
    ) if False else None

    raw_path = project_root / "temp" / "resources" / "my_posts_raw.json"
    if not raw_path.exists():
        sys.exit(f"Need {raw_path}. Run: python3 tools/unipile_get_my_posts.py first.")

    raw = json.loads(raw_path.read_text())
    by_url = {p.get("share_url", "").split("?")[0]: p for p in raw.get("posts", [])}

    metrics_ws = worksheet("metrics")
    headers = SCHEMA["metrics"]
    appended = 0
    for r in targets:
        url = str(r.get("post_url", "")).strip().split("?")[0]
        p = by_url.get(url)
        if not p:
            print(f"  no Unipile data for {r['angle_id']} ({url})", file=sys.stderr)
            continue
        data = {
            "angle_id": r["angle_id"],
            "post_url": url,
            "impressions": p.get("impressions_counter", ""),
            "reactions": p.get("reaction_counter", ""),
            "comments": p.get("comment_counter", ""),
            "reposts": p.get("repost_counter", ""),
            "saves": "",
            "sends": "",
            "dwell_ratio": "",
            "verdict": "",
            "pulled_at": now_iso(),
        }
        append_one(metrics_ws, headers, data)
        appended += 1
        print(f"  + {r['angle_id']}: imp={data['impressions']} rxn={data['reactions']} cmt={data['comments']}", file=sys.stderr)

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
    ap.add_argument("--from-published", help="ISO week, e.g. 2026-W18 — bulk pull all Posted angles")
    args = ap.parse_args()

    if args.from_published:
        bulk_from_published(args.from_published)
        return

    if not args.angle_id:
        sys.exit("Either --angle-id (single) or --from-published <week> (bulk) is required.")

    ws = worksheet("metrics")
    headers = SCHEMA["metrics"]
    data = {
        "angle_id": args.angle_id,
        "post_url": args.post_url,
        "impressions": args.impressions if args.impressions is not None else "",
        "reactions": args.reactions if args.reactions is not None else "",
        "comments": args.comments if args.comments is not None else "",
        "reposts": args.reposts if args.reposts is not None else "",
        "saves": args.saves if args.saves is not None else "",
        "sends": args.sends if args.sends is not None else "",
        "dwell_ratio": args.dwell_ratio if args.dwell_ratio is not None else "",
        "verdict": args.verdict or "",
        "pulled_at": now_iso(),
    }
    append_one(ws, headers, data)
    print(f"OK — appended metrics row for {args.angle_id}")


if __name__ == "__main__":
    main()
