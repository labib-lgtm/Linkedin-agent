"""Write a draft INTO the Sheet (cols O-S) and flip status Drafting → Drafted.

The Sheet is canonical for drafts. No more markdown files for the body.

Args (mutually exclusive sources for the body):
  --draft-body <text>   Inline text. Watch for shell escaping on long bodies.
  --body-file <path>    Read body from a file. Use this for anything > 500 chars
                        or any body containing quotes / dollar signs / newlines.

Required:
  --angle-id <id>
  --hook-chosen A|B|C
  --hook-alternates "<text>"  (the two non-chosen hooks, joined with `|||`)
  --critic-score "<text>"     e.g. "6/6 ship-ready"

Optional:
  --slide-outline <text> | --slide-outline-file <path>   for carousel/video formats

Run examples:
  python3 tools/sheets_mark_drafted.py \
      --angle-id 2026-W18-A09 \
      --hook-chosen B \
      --hook-alternates-file /tmp/alts.txt \
      --body-file /tmp/body.txt \
      --critic-score "6/6 ship-ready" \
      --slide-outline-file /tmp/slides.txt
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sheets_client import (
    SCHEMA, find_row_by_id, header_map, safe_update, worksheet, col_letter,
)


def _resolve(text: str | None, path: str | None) -> str:
    if text is not None and path is not None:
        sys.exit("Pass either inline text OR a file path, not both.")
    if path:
        p = Path(path)
        if not p.exists():
            sys.exit(f"File not found: {p}")
        return p.read_text()
    return text or ""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--hook-chosen", required=True, choices=["A", "B", "C"])
    ap.add_argument("--hook-alternates", default=None)
    ap.add_argument("--hook-alternates-file", default=None)
    ap.add_argument("--draft-body", default=None)
    ap.add_argument("--body-file", default=None)
    ap.add_argument("--critic-score", required=True)
    ap.add_argument("--slide-outline", default=None)
    ap.add_argument("--slide-outline-file", default=None)
    args = ap.parse_args()

    body = _resolve(args.draft_body, args.body_file)
    if not body.strip():
        sys.exit("Either --draft-body or --body-file is required (and non-empty).")
    alternates = _resolve(args.hook_alternates, args.hook_alternates_file)
    slide_outline = _resolve(args.slide_outline, args.slide_outline_file)

    if len(body) > 3000:
        print(
            f"WARN: body is {len(body)} chars; LinkedIn limit is 3000.",
            file=sys.stderr,
        )

    ws = worksheet("angles")
    hm = header_map(ws)
    row = find_row_by_id(ws, args.angle_id, id_col=hm["angle_id"])
    if row is None:
        sys.exit(f"angle_id not found: {args.angle_id}")

    updates = [
        {"range": f"{col_letter(hm['status'])}{row}", "values": [["Drafted"]]},
        {"range": f"{col_letter(hm['hook_chosen'])}{row}", "values": [[args.hook_chosen]]},
        {"range": f"{col_letter(hm['hook_alternates'])}{row}", "values": [[alternates]]},
        {"range": f"{col_letter(hm['draft_body'])}{row}", "values": [[body]]},
        {"range": f"{col_letter(hm['critic_score'])}{row}", "values": [[args.critic_score]]},
    ]
    if slide_outline:
        updates.append({
            "range": f"{col_letter(hm['slide_outline'])}{row}",
            "values": [[slide_outline]],
        })
    safe_update(ws, updates)
    print(
        f"OK — {args.angle_id} → Drafted "
        f"(hook {args.hook_chosen}, body {len(body)} chars, score '{args.critic_score}')"
    )


if __name__ == "__main__":
    main()
