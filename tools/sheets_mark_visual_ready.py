"""Mark an angle's visual asset ready.

Flips status Visualizing -> Visual Ready (or Drafted -> Visual Ready when the
asset was produced without going through the dispatcher), and writes the
asset_path back to the angles row.

Run:
  python3 tools/sheets_mark_visual_ready.py \
      --angle-id 2026-W18-A09 \
      --asset-path temp/outputs/assets/2026-W18-A09/image.png

The asset path is stored as a project-relative POSIX path so it works the
same on macOS and Linux.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sheets_client import (
    find_row_by_id, header_map, safe_update, worksheet, col_letter,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent

VALID_PRIOR_STATUSES = {"Drafted", "Visualizing", "Visual Ready"}


def _to_relative(asset_path: str) -> str:
    p = Path(asset_path)
    try:
        if p.is_absolute():
            rel = p.resolve().relative_to(PROJECT_ROOT)
        else:
            # Already relative — normalize and verify it lives under the project.
            rel = (PROJECT_ROOT / p).resolve().relative_to(PROJECT_ROOT)
    except ValueError:
        sys.exit(
            f"asset_path must live under the project root.\n"
            f"  given: {asset_path}\n"
            f"  root:  {PROJECT_ROOT}"
        )
    full = PROJECT_ROOT / rel
    if not full.exists():
        sys.exit(f"asset file not found at {full}")
    return rel.as_posix()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--asset-path", required=True,
                    help="Path to the rendered asset (PNG, PDF, or poll.md). "
                         "Must live under the project root.")
    ap.add_argument("--allow-any-status", action="store_true",
                    help="Skip the prior-status check (use only for manual recovery).")
    args = ap.parse_args()

    rel_path = _to_relative(args.asset_path)

    ws = worksheet("angles")
    hm = header_map(ws)
    row = find_row_by_id(ws, args.angle_id, id_col=hm["angle_id"])
    if row is None:
        sys.exit(f"angle_id not found: {args.angle_id}")

    if not args.allow_any_status:
        current = ws.cell(row, hm["status"]).value or ""
        if current.strip() not in VALID_PRIOR_STATUSES:
            sys.exit(
                f"{args.angle_id}: status is '{current}'. "
                f"Expected one of {sorted(VALID_PRIOR_STATUSES)}. "
                f"Use --allow-any-status to override."
            )

    safe_update(ws, [
        {"range": f"{col_letter(hm['status'])}{row}", "values": [["Visual Ready"]]},
        {"range": f"{col_letter(hm['asset_path'])}{row}", "values": [[rel_path]]},
    ])
    print(f"OK — {args.angle_id} -> Visual Ready (asset_path = {rel_path})")


if __name__ == "__main__":
    main()
