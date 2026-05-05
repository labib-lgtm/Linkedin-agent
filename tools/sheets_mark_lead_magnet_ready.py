"""Write the lead-magnet PDF path and/or shareable URL to the angle record.

Doesn't change `status` — the lead magnet runs in parallel with visual asset
generation, not as a status-blocking step.

Either or both flags can be passed:
  --lead-magnet-path  Local path under the project root (lead_magnet_path)
  --lead-magnet-url   Public Drive / DUB URL (lead_magnet_url)

Run:
  python3 tools/sheets_mark_lead_magnet_ready.py \\
      --angle-id 2026-W18-A08 \\
      --lead-magnet-path temp/outputs/assets/2026-W18-A08/lead_magnet.pdf

  python3 tools/sheets_mark_lead_magnet_ready.py \\
      --angle-id 2026-W18-A08 \\
      --lead-magnet-url https://drive.google.com/file/d/.../view

Filename kept (sheets_*) for compatibility with workflow doc commands; the
implementation now writes to Supabase, not Google Sheets.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from supabase_client import update_angle

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
    ap.add_argument(
        "--lead-magnet-path",
        default=None,
        help="Local path to the rendered PDF (writes lead_magnet_path).",
    )
    ap.add_argument(
        "--lead-magnet-url",
        default=None,
        help="Public shareable URL (writes lead_magnet_url).",
    )
    args = ap.parse_args()

    if not args.lead_magnet_path and not args.lead_magnet_url:
        sys.exit("Pass at least one of --lead-magnet-path or --lead-magnet-url.")

    fields: dict[str, str] = {}
    written: list[str] = []

    if args.lead_magnet_path:
        rel_path = _to_relative(args.lead_magnet_path)
        fields["lead_magnet_path"] = rel_path
        written.append(f"path={rel_path}")
    if args.lead_magnet_url:
        fields["lead_magnet_url"] = args.lead_magnet_url
        written.append(f"url={args.lead_magnet_url}")

    update_angle(args.angle_id, fields)
    print(f"OK — {args.angle_id} {' · '.join(written)}")


if __name__ == "__main__":
    main()
