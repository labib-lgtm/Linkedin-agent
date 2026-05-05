"""Write a draft INTO the canonical store and flip status Drafting → Drafted.

Supabase is canonical for drafts. No markdown files for the body.

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

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now writes to Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

from supabase_client import update_angle


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

    fields: dict[str, str] = {
        "status":          "Drafted",
        "hook_chosen":     args.hook_chosen,
        "hook_alternates": alternates,
        "draft_body":      body,
        "critic_score":    args.critic_score,
        "date_generated":  datetime.now(timezone.utc).isoformat(),
    }
    if slide_outline:
        fields["slide_outline"] = slide_outline

    update_angle(args.angle_id, fields)
    print(
        f"OK — {args.angle_id} → Drafted "
        f"(hook {args.hook_chosen}, body {len(body)} chars, score '{args.critic_score}')"
    )


if __name__ == "__main__":
    main()
