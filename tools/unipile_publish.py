"""Publish a Gate-3-approved post to LinkedIn via Unipile.

Reads the angle record from Supabase, branches on `format`, uploads media if
needed, posts via Unipile, optionally posts a first-comment, writes the
publish audit row to temp/outputs/published/YYYY-WW.md, then flips the angle
record to Posted with the live post URL.

Manual mode (default): prints the final body + asset preview + Unipile
request body and waits for `[y/n]` before firing. Use --auto to skip the gate
(only after you trust the pipeline).

Run:
  python3 tools/unipile_publish.py --angle-id 2026-W18-A08
  python3 tools/unipile_publish.py --angle-id 2026-W18-A08 --auto
  python3 tools/unipile_publish.py --angle-id 2026-W18-A08 \\
      --first-comment-file /tmp/first.txt
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Local imports — `unipile_client` and `supabase_client` live alongside this file.
import supabase_client
from unipile_client import env, base_url, request

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLISHED_DIR = PROJECT_ROOT / "temp" / "outputs" / "published"

POST_PATH = "/api/v1/posts"
COMMENT_PATH_TPL = "/api/v1/posts/{post_id}/comments"


def _read_angle(angle_id: str) -> dict:
    """Pull the angle record from Supabase."""
    angle = supabase_client.get_angle(angle_id)
    if angle is None:
        sys.exit(f"angle_id not found: {angle_id}")
    return angle


def _resolve_asset(angle_id: str, fmt: str, asset_path_cell: str) -> Path | None:
    """Return absolute Path to the asset file, or None for text/poll formats."""
    if fmt in ("text", "poll", "video"):
        return None
    if not asset_path_cell:
        sys.exit(
            f"{angle_id}: format='{fmt}' but asset_path is empty. "
            f"Run 05_visual_asset.md first, then sheets_mark_visual_ready.py."
        )
    p = (PROJECT_ROOT / asset_path_cell).resolve()
    if not p.exists():
        sys.exit(f"Asset file not found: {p}")
    return p


def _confirm_or_exit(prompt: str) -> None:
    sys.stderr.write(prompt)
    sys.stderr.flush()
    answer = sys.stdin.readline().strip().lower()
    if answer not in ("y", "yes"):
        sys.exit("Aborted.")


def _publish_text_only(account_id: str, body: str) -> dict:
    return request(
        "POST",
        POST_PATH,
        body={"account_id": account_id, "text": body},
    )


def _publish_with_media(
    account_id: str, body: str, asset_path: Path, media_kind: str,
) -> dict:
    """POST a multipart form to Unipile with the post body + an attachment.

    `media_kind`:
        image    -> image/png|jpeg
        document -> application/pdf (LinkedIn document carousel)
    """
    try:
        import requests
    except ImportError:
        sys.exit(
            "The `requests` library is required for multipart uploads.\n"
            "Run: pip3 install --user -r tools/requirements.txt"
        )

    url = base_url().rstrip("/") + POST_PATH
    headers = {
        "X-API-KEY": env("UNIPILE_API_KEY"),
        "accept": "application/json",
    }
    mime = "image/png" if media_kind == "image" else "application/pdf"
    if asset_path.suffix.lower() in (".jpg", ".jpeg") and media_kind == "image":
        mime = "image/jpeg"

    with asset_path.open("rb") as fh:
        files = [("attachments", (asset_path.name, fh, mime))]
        data = {"account_id": account_id, "text": body}
        resp = requests.post(url, headers=headers, data=data, files=files, timeout=120)

    if resp.status_code >= 400:
        sys.exit(f"Unipile {POST_PATH} -> {resp.status_code}\n{resp.text}")
    return resp.json() if resp.text else {}


def _post_id_from_response(payload: dict) -> str:
    """Pull the post identifier out of Unipile's response.

    Unipile's exact field name varies; we accept several common keys.
    """
    for key in ("post_id", "id", "social_id", "urn"):
        v = payload.get(key)
        if v:
            return str(v)
    sys.exit(f"Unipile response missing post id. Payload: {json.dumps(payload)[:600]}")


def _post_url_from_response(payload: dict, post_id: str) -> str:
    """Best-effort extraction of the public LinkedIn URL.

    Unipile sometimes returns it as `share_url` / `url` / similar. Otherwise
    we fall back to a URN-based URL the user can verify manually.
    """
    for key in ("share_url", "url", "post_url", "public_url"):
        v = payload.get(key)
        if v:
            return str(v)
    return f"https://www.linkedin.com/feed/update/{post_id}/"


def _post_first_comment(post_id: str, account_id: str, text: str) -> None:
    path = COMMENT_PATH_TPL.format(post_id=post_id)
    request("POST", path, body={"account_id": account_id, "text": text})


def _append_published_audit(angle_id: str, post_url: str, fmt: str) -> None:
    """Write a local audit row AND an audit_log event in Supabase.

    The local file is kept as a belt-and-suspenders backup; the canonical
    audit lives in Supabase's `audit_log` table.
    """
    PUBLISHED_DIR.mkdir(parents=True, exist_ok=True)
    iso = datetime.now(timezone.utc).isoformat(timespec="seconds")
    week = datetime.now(timezone.utc).strftime("%Y-W%V")
    fpath = PUBLISHED_DIR / f"{week}.md"
    header = (
        f"# Published — {week}\n\n"
        f"Audit log of every post that shipped this week. Local-first;\n"
        f"the Supabase audit_log table is the cloud mirror.\n\n"
        f"| When (UTC) | angle_id | format | post_url |\n"
        f"|---|---|---|---|\n"
    )
    if not fpath.exists():
        fpath.write_text(header)
    with fpath.open("a") as f:
        f.write(f"| {iso} | {angle_id} | {fmt} | {post_url} |\n")

    # Cloud audit. Best-effort — the publish itself is already done and
    # successful at this point; we don't want to fail the run on this.
    try:
        supabase_client.insert_audit_event(
            angle_id=angle_id,
            event_type="post_published",
            payload={"format": fmt, "post_url": post_url, "ts": iso},
        )
    except Exception as e:
        print(
            f"WARN: audit_log insert failed: {e}. The local audit row is "
            f"still written.",
            file=sys.stderr,
        )


def _sync_to_sheet(angle_id: str, post_url: str) -> None:
    """Run sheets_mark_posted.py. If it fails, log but don't crash —
    the local audit row already captured the publish."""
    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "tools" / "sheets_mark_posted.py"),
        "--angle-id", angle_id,
        "--post-url", post_url,
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(
            f"WARN: sheets_mark_posted failed (exit {e.returncode}). "
            f"The post is live and audited locally; manual reconcile needed.",
            file=sys.stderr,
        )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--first-comment-file", default=None,
                    help="Optional path to a text file containing the first comment.")
    ap.add_argument("--auto", action="store_true",
                    help="Skip the [y/n] preview gate. Use only after you trust the pipeline.")
    args = ap.parse_args()

    angle = _read_angle(args.angle_id)
    fmt = str(angle.get("format", "")).strip().lower()
    body = str(angle.get("draft_body", "")).strip()
    asset_path_cell = str(angle.get("asset_path", "")).strip()
    cta_keyword = str(angle.get("cta_keyword", "")).strip()
    status = str(angle.get("status", "")).strip()

    if not body:
        sys.exit(f"{args.angle_id}: draft_body is empty. Run 04_post_writer first.")
    if status not in ("Visual Ready", "Drafted", "Scheduled"):
        sys.exit(
            f"{args.angle_id}: status is '{status}'. "
            f"Expected 'Visual Ready' (or 'Drafted' for text-only / 'Scheduled')."
        )
    if fmt not in supabase_client.FORMAT_VALUES:
        sys.exit(f"{args.angle_id}: invalid format '{fmt}'.")

    asset = _resolve_asset(args.angle_id, fmt, asset_path_cell)
    media_kind = None
    if fmt == "image":
        media_kind = "image"
    elif fmt == "carousel":
        media_kind = "document"

    first_comment = ""
    if args.first_comment_file:
        first_comment = Path(args.first_comment_file).read_text().strip()

    account_id = env("UNIPILE_LINKEDIN_ACCOUNT_ID")

    if not args.auto:
        sys.stderr.write("=" * 60 + "\n")
        sys.stderr.write(f"PUBLISH PREVIEW — {args.angle_id} ({fmt})\n")
        sys.stderr.write("=" * 60 + "\n\n")
        sys.stderr.write(f"BODY ({len(body)} chars):\n{body}\n\n")
        if asset:
            sys.stderr.write(f"ASSET: {asset.relative_to(PROJECT_ROOT)} "
                             f"({asset.stat().st_size // 1024} KB, kind={media_kind})\n\n")
        if cta_keyword:
            sys.stderr.write(f"CTA keyword (commenters type this): {cta_keyword}\n\n")
        if first_comment:
            sys.stderr.write(f"FIRST COMMENT: {first_comment}\n\n")
        sys.stderr.write("=" * 60 + "\n")
        _confirm_or_exit("Publish to LinkedIn? [y/N]: ")

    print(f"Publishing {args.angle_id} ({fmt})...", file=sys.stderr)
    if asset is None:
        resp = _publish_text_only(account_id, body)
    else:
        resp = _publish_with_media(account_id, body, asset, media_kind)

    post_id = _post_id_from_response(resp)
    post_url = _post_url_from_response(resp, post_id)
    print(f"  ✓ post live: {post_url}", file=sys.stderr)

    if first_comment:
        time.sleep(10)
        try:
            _post_first_comment(post_id, account_id, first_comment)
            print(f"  ✓ first comment posted", file=sys.stderr)
        except Exception as e:
            print(f"  WARN: first comment failed: {e}", file=sys.stderr)

    _append_published_audit(args.angle_id, post_url, fmt)
    _sync_to_sheet(args.angle_id, post_url)

    print(json.dumps({
        "angle_id": args.angle_id,
        "format": fmt,
        "post_id": post_id,
        "post_url": post_url,
    }, indent=2))


if __name__ == "__main__":
    main()
