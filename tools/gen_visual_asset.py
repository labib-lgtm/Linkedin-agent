"""Visual asset dispatcher — reads a Drafted angle, branches on format.

Runs after Gate 2 approval of the post draft from 04_post_writer. Reads the
angle row from the Sheet, prints the context the agent needs to invoke the
right design skill (linkedin-image-asset, or the carousel chain, or write
poll options), and atomically flips status Drafted -> Visualizing so re-runs
are idempotent.

Output is JSON to stdout. The agent reads it, then takes the format-specific
next steps documented in workflows/05_visual_asset.md.

Run:
  python3 tools/gen_visual_asset.py --angle-id 2026-W18-A09
  python3 tools/gen_visual_asset.py --angle-id 2026-W18-A09 --no-flip   # peek without state change
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sheets_client import (
    FORMAT_VALUES, find_row_by_id, header_map, normalize_image_size,
    safe_update, worksheet, col_letter,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ASSETS_ROOT = PROJECT_ROOT / "temp" / "outputs" / "assets"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--no-flip", action="store_true",
                    help="Read-only — don't flip status Drafted -> Visualizing")
    args = ap.parse_args()

    ws = worksheet("angles")
    hm = header_map(ws)
    rows = ws.get_all_records()

    target = None
    target_row_idx = None
    for i, r in enumerate(rows, start=2):
        if str(r.get("angle_id", "")).strip() == args.angle_id:
            target = r
            target_row_idx = i
            break
    if target is None:
        sys.exit(f"angle_id not found: {args.angle_id}")

    status = str(target.get("status", "")).strip()
    fmt = str(target.get("format", "")).strip().lower()
    body = str(target.get("draft_body", "")).strip()

    if fmt not in FORMAT_VALUES:
        sys.exit(f"Invalid format '{fmt}' on {args.angle_id}. "
                 f"Expected one of {FORMAT_VALUES}.")

    # Gate 2 must have passed — body must exist and status should be Drafted.
    # Visual Ready or Visualizing means we're re-running.
    if not body:
        sys.exit(f"{args.angle_id}: draft_body is empty. Run 04_post_writer first.")
    if status not in ("Drafted", "Visualizing", "Visual Ready"):
        sys.exit(f"{args.angle_id}: status is '{status}'. "
                 f"Expected 'Drafted' (after Gate 2 approval). "
                 f"If you want to re-run, the row should be 'Visualizing' or 'Visual Ready'.")

    # Text format: nothing to do, hand off to 06.
    if fmt == "text":
        print(json.dumps({
            "angle_id": args.angle_id,
            "format": "text",
            "action": "skip",
            "next": "Hand off directly to 06_content_calendar.md — no visual asset needed.",
        }, indent=2))
        return

    # Video deferred per workflow 05 — not in scope.
    if fmt == "video":
        sys.exit(f"{args.angle_id}: format='video' is deferred (see 05_visual_asset.md). "
                 f"Either change the format or skip this angle.")

    # Make sure the per-angle asset folder exists.
    asset_dir = ASSETS_ROOT / args.angle_id
    asset_dir.mkdir(parents=True, exist_ok=True)

    # Flip Drafted -> Visualizing (idempotent: only flip if currently Drafted).
    if not args.no_flip and status == "Drafted":
        safe_update(ws, [{
            "range": f"{col_letter(hm['status'])}{target_row_idx}",
            "values": [["Visualizing"]],
        }])

    # Build the context bundle the agent needs to invoke the right skill.
    out = {
        "angle_id": args.angle_id,
        "format": fmt,
        "pillar": str(target.get("pillar", "")).strip(),
        "hook_chosen": str(target.get("hook_chosen", "")).strip(),
        "draft_body": body,
        "cta_keyword": str(target.get("cta_keyword", "")).strip(),
        "winner_patterns": str(target.get("winner_patterns", "")).strip(),
        "slide_outline": str(target.get("slide_outline", "")).strip(),
        "asset_dir": str(asset_dir.relative_to(PROJECT_ROOT)),
    }

    if fmt == "image":
        try:
            image_size = normalize_image_size(target.get("image_size"))
        except ValueError as e:
            sys.exit(f"{args.angle_id}: {e}")
        out["image_size"] = image_size
        out["next_steps"] = [
            "Invoke `linkedin-image-asset` skill with output_mode=ai-prompt.",
            "Choose archetype (stat-slab / before-after / industrial) based on draft_body.",
            f"Write the prompt's Dimensions line as {image_size} "
            f"(LinkedIn aspect derived from the Sheet's image_size column).",
            "STRIP logo lines from the prompt (per project decision: no logo on assets).",
            f"Write prompt to {out['asset_dir']}/prompt.md",
            f"Run: python3 tools/gen_image_render.py --prompt-file {out['asset_dir']}/prompt.md "
            f"--out {out['asset_dir']}/image.png --size {image_size}",
            "Present image in chat for Gate 3 approval.",
            f"After approval: python3 tools/sheets_mark_visual_ready.py "
            f"--angle-id {args.angle_id} --asset-path {out['asset_dir']}/image.png",
        ]
    elif fmt == "carousel":
        out["next_steps"] = [
            "Invoke `linkedin-carousel-outline` skill -> save outline to "
            f"{out['asset_dir']}/outline.md",
            "Invoke `linkedin-carousel-design` skill -> save spec to "
            f"{out['asset_dir']}/spec.md "
            "(omit logo lines on every slide block — no logo per project decision).",
            "Invoke `linkedin-carousel-build` skill with brand_assets_path omitted -> "
            f"writes {out['asset_dir']}/carousel.pptx and carousel.pdf "
            "(skip the 'logo present on every slide' validation).",
            "Present .pdf in chat for Gate 3 approval.",
            f"After approval: python3 tools/sheets_mark_visual_ready.py "
            f"--angle-id {args.angle_id} --asset-path {out['asset_dir']}/carousel.pdf",
        ]
    elif fmt == "poll":
        out["next_steps"] = [
            "Write the poll: question that forces a real choice (not a survey), "
            "3-4 mutually-exclusive options, 'comment for option C' engagement prompt.",
            f"Run: python3 tools/gen_poll_options.py --angle-id {args.angle_id} "
            f"--question-file /tmp/{args.angle_id}-q.txt "
            f"--options-file /tmp/{args.angle_id}-opts.txt",
            "Present poll in chat for Gate 3 approval.",
            f"After approval: python3 tools/sheets_mark_visual_ready.py "
            f"--angle-id {args.angle_id} --asset-path {out['asset_dir']}/poll.md",
        ]

    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
