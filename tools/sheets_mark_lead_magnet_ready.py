"""Write the lead-magnet PDF path to the angles row.

Mirrors sheets_mark_visual_ready.py but does NOT change `status` — the
lead magnet runs in parallel with visual asset generation, not as a
status-blocking step. Phase B will add a sibling `lead_magnet_url` once
Drive upload + DUB short-link are wired.

Run:
  python3 tools/sheets_mark_lead_magnet_ready.py \
      --angle-id 2026-W18-A08 \
      --lead-magnet-path temp/outputs/assets/2026-W18-A08/lead_magnet.pdf
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sheets_client import (
    find_row_by_id, header_map, safe_update, worksheet, col_letter,
)

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def _to_relative(path: str) -> str:
    p = Path(path)
    try:
        if p.is_absolute():
            rel = p.resolve().relative_to(PROJECT_ROOT)
        else:
            rel = (PROJECT_ROOT / p).resolve().relative_to(PROJECT_ROOT)
    except ValueError:
        sys.exit(
            f"lead_magnet_path must live under the project root.\n"
            f"  given: {path}\n"
            f"  root:  {PROJECT_ROOT}"
        )
    full = PROJECT_ROOT / rel
    if not full.exists():
        sys.exit(f"lead-magnet file not found at {full}")
    return rel.as_posix()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--angle-id", required=True)
    ap.add_argument("--lead-magnet-path", required=True,
                    help="Path to the rendered PDF. Must live under the project root.")
    args = ap.parse_args()

    rel_path = _to_relative(args.lead_magnet_path)

    ws = worksheet("angles")
    hm = header_map(ws)
    row = find_row_by_id(ws, args.angle_id, id_col=hm["angle_id"])
    if row is None:
        sys.exit(f"angle_id not found: {args.angle_id}")

    safe_update(ws, [{
        "range": f"{col_letter(hm['lead_magnet_path'])}{row}",
        "values": [[rel_path]],
    }])
    print(f"OK — {args.angle_id} lead_magnet_path = {rel_path}")


if __name__ == "__main__":
    main()
