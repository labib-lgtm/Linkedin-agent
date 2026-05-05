"""Fire the Trigger.dev `cta-comment-response` task from Python.

Wraps Trigger.dev's REST trigger endpoint:
    POST https://api.trigger.dev/api/v1/tasks/<task-id>/trigger

Auth: `Authorization: Bearer <TRIGGER_SECRET_KEY>`
  TRIGGER_SECRET_KEY is created at cloud.trigger.dev → API Keys (Server-side
  key for the dev or prod environment). Stored in .env locally.

Used by tools/unipile_monitor_comments.py when it detects a CTA-keyword
comment on a published post.

Run (one-shot CLI):
  python3 tools/trigger_engagement.py \\
      --angle-id 2026-W18-A08 \\
      --post-url https://www.linkedin.com/feed/update/urn:li:activity:... \\
      --comment-id urn:li:comment:... \\
      --commenter-id ACoAA... \\
      --commenter-name "Jane Doe" \\
      --cta-keyword KILL \\
      --lead-magnet-url https://drive.google.com/file/d/...

Importable:
  from trigger_engagement import trigger_cta_response
  run = trigger_cta_response(angle_id=..., post_url=..., ...)
  # run["id"] is the Trigger.dev run ID; persist it on the recipient row.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TASK_ID = "cta-comment-response"
DEFAULT_API_BASE = "https://api.trigger.dev"


def _load_env() -> dict[str, str]:
    env_path = PROJECT_ROOT / ".env"
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


_ENV = _load_env()


def _env(key: str, default: str | None = None) -> str:
    val = os.environ.get(key) or _ENV.get(key) or default
    if not val:
        sys.exit(
            f"Missing env var: {key}\n"
            f"For TRIGGER_SECRET_KEY, get it at cloud.trigger.dev → API Keys."
        )
    return val


def trigger_cta_response(
    angle_id: str,
    post_url: str,
    comment_id: str,
    commenter_id: str,
    commenter_name: str,
    cta_keyword: str,
    lead_magnet_url: str,
    recipient_id: str | None = None,
) -> dict[str, Any]:
    """POST to Trigger.dev to fire the cta-comment-response task.

    Returns the parsed JSON response, which includes `id` (the run ID).
    Raises RuntimeError on HTTP error.
    """
    try:
        import requests
    except ImportError:
        sys.exit(
            "The `requests` library is required.\n"
            "Run: pip3 install --user -r tools/requirements.txt"
        )

    api_base = _env("TRIGGER_API_BASE", DEFAULT_API_BASE).rstrip("/")
    url = f"{api_base}/api/v1/tasks/{TASK_ID}/trigger"
    headers = {
        "Authorization": f"Bearer {_env('TRIGGER_SECRET_KEY')}",
        "Content-Type": "application/json",
    }
    payload = {
        "payload": {
            "angle_id": angle_id,
            "post_url": post_url,
            "comment_id": comment_id,
            "commenter_id": commenter_id,
            "commenter_name": commenter_name,
            "cta_keyword": cta_keyword,
            "lead_magnet_url": lead_magnet_url,
            "recipient_id": recipient_id,
        },
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(
            f"Trigger.dev fire failed: {resp.status_code}\n{resp.text}"
        )
    return resp.json()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--post-url", required=True)
    ap.add_argument("--comment-id", required=True)
    ap.add_argument("--commenter-id", required=True)
    ap.add_argument("--commenter-name", required=True)
    ap.add_argument("--cta-keyword", required=True)
    ap.add_argument("--lead-magnet-url", required=True)
    ap.add_argument("--recipient-id", default=None)
    args = ap.parse_args()

    run = trigger_cta_response(
        angle_id=args.angle_id,
        post_url=args.post_url,
        comment_id=args.comment_id,
        commenter_id=args.commenter_id,
        commenter_name=args.commenter_name,
        cta_keyword=args.cta_keyword,
        lead_magnet_url=args.lead_magnet_url,
        recipient_id=args.recipient_id,
    )
    print(json.dumps(run, indent=2))


if __name__ == "__main__":
    main()
