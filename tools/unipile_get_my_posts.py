"""Pull every LinkedIn post Labib has authored, via Unipile.

Strategy:
  1. GET /api/v1/accounts/{account_id} -> extract the LinkedIn member identifier
     (the one that starts with ACo... ; called "provider_id" or similar in the account payload).
  2. GET /api/v1/users/{identifier}/posts paginated via `cursor` -> walk all pages.
  3. Save raw JSON to temp/resources/my_posts_raw.json
  4. Write a flat CSV-ish markdown table to temp/resources/my_posts_index.md
     so downstream analysis is greppable without re-loading JSON.

Run: python3 tools/unipile_get_my_posts.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from unipile_client import env, get

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUT_RAW = PROJECT_ROOT / "temp" / "resources" / "my_posts_raw.json"
OUT_MD = PROJECT_ROOT / "temp" / "resources" / "my_posts_index.md"


def find_linkedin_identifier(account: dict) -> str:
    """Walk the account payload and find the LinkedIn member identifier (starts with ACo)."""
    candidates: list[str] = []

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if isinstance(v, str) and v.startswith("ACo") and len(v) > 5:
                    candidates.append(v)
                walk(v)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(account)
    if not candidates:
        print("Full account payload:", json.dumps(account, indent=2)[:2000], file=sys.stderr)
        sys.exit("Could not find a LinkedIn identifier (ACo...) in the account payload.")
    return candidates[0]


def fetch_all_posts(identifier: str, account_id: str) -> list[dict]:
    posts: list[dict] = []
    cursor: str | None = None
    page = 0
    while True:
        page += 1
        params = {"account_id": account_id, "limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = get(f"/api/v1/users/{identifier}/posts", params=params)
        items = resp.get("items") or resp.get("data") or []
        posts.extend(items)
        print(f"  page {page}: +{len(items)} posts (total: {len(posts)})", file=sys.stderr)
        cursor = resp.get("cursor") or resp.get("next_cursor") or resp.get("paging", {}).get("cursors", {}).get("after")
        if not cursor or not items:
            break
    return posts


def to_md(posts: list[dict]) -> str:
    lines = [
        "# My LinkedIn Posts — Pulled from Unipile",
        "",
        "Sorted newest first. Counters are reactions/comments/reposts/impressions when Unipile returns them.",
        "Use this for [09_performance_review.md](../../workflows/09_performance_review.md).",
        "",
        "| # | Posted | Likes | Comments | Reposts | Impressions | Type | URN | First 100 chars |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for i, p in enumerate(posts, start=1):
        posted = p.get("date") or p.get("posted_at") or p.get("created_at") or ""
        likes = p.get("reaction_counter") or p.get("likes") or p.get("reactions") or ""
        comments = p.get("comment_counter") or p.get("comments") or ""
        reposts = p.get("repost_counter") or p.get("reposts") or p.get("shares") or ""
        impressions = p.get("impressions_counter") or p.get("impressions") or ""
        ptype = p.get("post_type") or p.get("type") or ""
        urn = p.get("social_id") or p.get("urn") or p.get("id") or ""
        text = (p.get("text") or p.get("body") or p.get("commentary") or "").replace("\n", " ").replace("|", "\\|")
        snippet = text[:100]
        lines.append(f"| {i} | {posted} | {likes} | {comments} | {reposts} | {impressions} | {ptype} | {urn} | {snippet} |")
    return "\n".join(lines) + "\n"


def main() -> None:
    account_id = env("UNIPILE_LINKEDIN_ACCOUNT_ID")
    print(f"Fetching account {account_id}...", file=sys.stderr)
    account = get(f"/api/v1/accounts/{account_id}")
    identifier = find_linkedin_identifier(account)
    print(f"LinkedIn identifier: {identifier}", file=sys.stderr)

    print("Fetching posts...", file=sys.stderr)
    posts = fetch_all_posts(identifier, account_id)
    print(f"Total posts fetched: {len(posts)}", file=sys.stderr)

    OUT_RAW.parent.mkdir(parents=True, exist_ok=True)
    OUT_RAW.write_text(json.dumps({"identifier": identifier, "count": len(posts), "posts": posts}, indent=2))
    print(f"Wrote {OUT_RAW}", file=sys.stderr)

    OUT_MD.write_text(to_md(posts))
    print(f"Wrote {OUT_MD}", file=sys.stderr)


if __name__ == "__main__":
    main()
