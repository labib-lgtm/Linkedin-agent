"""DEPRECATED for production. Replaced by trigger/monitor_post_comments.ts
(Trigger.dev cron, every 5 min). Kept here for ad-hoc CLI testing only —
e.g. probing a specific post URL on demand without waiting for the next
cron tick.

Poll Unipile for new comments on a published post and fire the
Trigger.dev cta-comment-response task whenever a comment matches the
angle's CTA keyword.

Per workflow 08, the cadence is:
  - Every 2 min for the first 60 min after post-live
  - Every 30 min for the next 5 hours
  - Stop after that window unless --indefinite is set

Comments seen across runs are cached at:
  temp/outputs/engagement/<angle_id>-seen.json

So re-running this monitor doesn't double-fire on the same comment. Each new
CTA match inserts a `queued` row into the `lead_magnet_recipients` Supabase
table, fires the Trigger.dev task, and stores the run ID back on that row.

Run:
  python3 tools/unipile_monitor_comments.py --angle-id 2026-W18-A08
  python3 tools/unipile_monitor_comments.py --angle-id 2026-W18-A08 --indefinite
  python3 tools/unipile_monitor_comments.py --angle-id 2026-W18-A08 --once
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import supabase_client
from unipile_client import env, get
from trigger_engagement import trigger_cta_response

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENGAGEMENT_DIR = PROJECT_ROOT / "temp" / "outputs" / "engagement"

POLL_FAST_INTERVAL_SEC = 120   # first 60 min: every 2 min
POLL_FAST_DURATION_SEC = 60 * 60
POLL_SLOW_INTERVAL_SEC = 30 * 60   # next 5 hours: every 30 min
POLL_SLOW_DURATION_SEC = 5 * 60 * 60


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _seen_path(angle_id: str) -> Path:
    return ENGAGEMENT_DIR / f"{angle_id}-seen.json"


def _load_seen(angle_id: str) -> set[str]:
    p = _seen_path(angle_id)
    if not p.exists():
        return set()
    try:
        return set(json.loads(p.read_text()).get("comment_ids", []))
    except Exception:
        return set()


def _save_seen(angle_id: str, seen: set[str]) -> None:
    ENGAGEMENT_DIR.mkdir(parents=True, exist_ok=True)
    _seen_path(angle_id).write_text(
        json.dumps({"comment_ids": sorted(seen)}, indent=2)
    )


def _load_angle(angle_id: str) -> dict:
    angle = supabase_client.get_angle(angle_id)
    if angle is None:
        sys.exit(f"angle_id not found: {angle_id}")
    return angle


def _post_id_from_url(post_url: str) -> str:
    """Extract the LinkedIn URN / activity id from a post URL.

    LinkedIn post URLs look like:
      https://www.linkedin.com/feed/update/urn:li:activity:1234567890/
    Unipile generally accepts either the urn or the bare activity id.
    """
    m = re.search(r"urn:li:[a-zA-Z]+:\d+", post_url)
    if m:
        return m.group(0)
    m = re.search(r"/(\d{15,25})/?", post_url)
    if m:
        return m.group(1)
    sys.exit(f"Couldn't extract a post id from: {post_url}")


def _fetch_comments(post_id: str) -> list[dict]:
    """Fetch comments on a post via Unipile.

    The exact endpoint varies by Unipile version; we try the common ones.
    Falls back gracefully if the first endpoint shape doesn't return items.
    """
    paths = [
        f"/api/v1/posts/{post_id}/comments",
        f"/api/v1/comments",  # fallback, with post_id as query param
    ]
    last_err: Exception | None = None
    for i, path in enumerate(paths):
        try:
            params: dict[str, Any] | None = None
            if i == 1:
                params = {"post_id": post_id}
            resp = get(path, params=params)
            items = resp.get("items") or resp.get("data") or resp.get("comments") or []
            if items or resp.get("paging") or resp.get("cursor"):
                return items
        except Exception as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    return []


def _comment_id(c: dict) -> str:
    for key in ("id", "comment_id", "social_id", "urn"):
        v = c.get(key)
        if v:
            return str(v)
    return json.dumps(c, sort_keys=True)[:60]


def _comment_text(c: dict) -> str:
    return str(c.get("text") or c.get("body") or c.get("commentary") or "")


def _commenter_id(c: dict) -> str:
    # Current Unipile shape: id at author_details.id (LinkedIn member URN)
    ad = c.get("author_details")
    if isinstance(ad, dict):
        for key in ("id", "provider_id", "public_identifier"):
            if ad.get(key):
                return str(ad[key])
    # Legacy / alt shapes
    for path in ("commenter", "user"):
        node = c.get(path)
        if isinstance(node, dict):
            for key in ("id", "provider_id", "public_identifier"):
                if node.get(key):
                    return str(node[key])
    author = c.get("author")
    if isinstance(author, dict):
        for key in ("id", "provider_id", "public_identifier"):
            if author.get(key):
                return str(author[key])
    for key in ("commenter_id", "author_id"):
        if c.get(key):
            return str(c[key])
    return "unknown"


def _commenter_name(c: dict) -> str:
    # Current Unipile shape: author is a plain string display name
    author = c.get("author")
    if isinstance(author, str) and author.strip():
        return author.strip()
    # Legacy / alt shapes
    for path in ("commenter", "user"):
        node = c.get(path)
        if isinstance(node, dict):
            for key in ("name", "full_name", "display_name"):
                if node.get(key):
                    return str(node[key])
    if isinstance(author, dict):
        for key in ("name", "full_name", "display_name"):
            if author.get(key):
                return str(author[key])
    return ""


def _within_distance_one(a: str, b: str) -> bool:
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    i = j = edits = 0
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(a) == len(b):
            i += 1
            j += 1  # substitution
        elif len(a) > len(b):
            i += 1  # delete from a
        else:
            j += 1  # insert into a (== delete from b)
    return edits + (len(a) - i) + (len(b) - j) <= 1


def _matches_cta(text: str, cta_keyword: str) -> bool:
    """Match cta_keyword against comment text.

    Two-tier:
      1. Exact word-boundary match, case-insensitive (strict path).
      2. For keywords >=6 chars, ALSO accept any whole word within edit
         distance 1 (catches typos like 'Thresold', 'Threshhold').
         Short keywords like 'KILL' would over-match so they stay strict.
    """
    if not cta_keyword:
        return False
    if re.search(rf"\b{re.escape(cta_keyword)}\b", text, re.IGNORECASE):
        return True
    if len(cta_keyword) < 6:
        return False
    lower = cta_keyword.lower()
    return any(
        _within_distance_one(w, lower) for w in re.findall(r"[a-z]+", text.lower())
    )


def _write_recipient_row(angle: dict, comment: dict, run_id: str | None) -> str:
    """Insert a row into lead_magnet_recipients. Returns the recipient_id."""
    fields = {
        "angle_id":       angle["angle_id"],
        "post_url":       angle.get("post_url"),
        "comment_id":     _comment_id(comment),
        "commenter_id":   _commenter_id(comment),
        "commenter_name": _commenter_name(comment),
        "cta_keyword":    angle.get("cta_keyword"),
        "trigger_run_id": run_id or None,
        "status":         "queued" if run_id else "failed",
    }
    inserted = supabase_client.insert_recipient(fields)
    return str(inserted["recipient_id"])


def _handle_match(angle: dict, comment: dict) -> None:
    cid = _comment_id(comment)
    cname = _commenter_name(comment) or "<unknown>"
    print(f"  CTA match — {cname} on {cid[:30]}...", file=sys.stderr)

    lead_magnet_url = str(angle.get("lead_magnet_url", "")).strip()
    if not lead_magnet_url:
        print(
            f"  WARN: angle has no lead_magnet_url — Trigger.dev task will run "
            f"but the DM payload will be empty. Run drive_upload_lead_magnet.py first.",
            file=sys.stderr,
        )

    try:
        run = trigger_cta_response(
            angle_id=angle["angle_id"],
            post_url=str(angle.get("post_url", "")),
            comment_id=cid,
            commenter_id=_commenter_id(comment),
            commenter_name=_commenter_name(comment),
            cta_keyword=str(angle.get("cta_keyword", "")),
            lead_magnet_url=lead_magnet_url,
        )
        run_id = run.get("id") or run.get("run_id") or ""
        print(f"  ✓ Trigger.dev run: {run_id}", file=sys.stderr)
    except Exception as e:
        run_id = ""
        print(f"  ERROR firing Trigger.dev: {e}", file=sys.stderr)

    try:
        _write_recipient_row(angle, comment, run_id)
    except Exception as e:
        print(f"  ERROR writing recipient row: {e}", file=sys.stderr)


def _poll_once(angle: dict, seen: set[str]) -> None:
    post_id = _post_id_from_url(str(angle["post_url"]))
    cta = str(angle.get("cta_keyword", "")).strip()
    if not cta:
        sys.exit(f"angle {angle['angle_id']} has no cta_keyword")

    try:
        comments = _fetch_comments(post_id)
    except Exception as e:
        print(f"  fetch failed: {e}", file=sys.stderr)
        return

    new_count = 0
    for c in comments:
        cid = _comment_id(c)
        if cid in seen:
            continue
        seen.add(cid)
        new_count += 1
        if _matches_cta(_comment_text(c), cta):
            _handle_match(angle, c)
    if new_count:
        print(f"  ({new_count} new comment(s), seen total: {len(seen)})", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--once", action="store_true",
                    help="Poll a single time and exit (good for cron / manual debug).")
    ap.add_argument("--indefinite", action="store_true",
                    help="Keep polling at the slow cadence past the 6-hour window.")
    args = ap.parse_args()

    angle = _load_angle(args.angle_id)
    if not angle.get("post_url"):
        sys.exit(f"{args.angle_id}: post_url empty. Run unipile_publish.py first.")

    seen = _load_seen(args.angle_id)
    print(f"Monitoring comments on {angle['angle_id']} (CTA={angle.get('cta_keyword')})",
          file=sys.stderr)

    if args.once:
        _poll_once(angle, seen)
        _save_seen(args.angle_id, seen)
        return

    started = time.time()
    while True:
        elapsed = time.time() - started
        if elapsed < POLL_FAST_DURATION_SEC:
            interval = POLL_FAST_INTERVAL_SEC
        elif elapsed < POLL_FAST_DURATION_SEC + POLL_SLOW_DURATION_SEC:
            interval = POLL_SLOW_INTERVAL_SEC
        elif args.indefinite:
            interval = POLL_SLOW_INTERVAL_SEC
        else:
            print("Window closed. Exiting.", file=sys.stderr)
            break

        _poll_once(angle, seen)
        _save_seen(args.angle_id, seen)
        time.sleep(interval)


if __name__ == "__main__":
    main()
