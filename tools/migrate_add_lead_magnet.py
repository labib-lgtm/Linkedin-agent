"""One-shot migration: add `lead_magnet_path` as column W on the angles tab.

Idempotent. If lead_magnet_path is already there, exits cleanly. Mirrors
migrate_add_image_size.py.

Run: python3 tools/migrate_add_lead_magnet.py
"""
from __future__ import annotations

import sys

from sheets_client import SCHEMA, worksheet, col_letter


def main() -> None:
    ws = worksheet("angles")
    expected = SCHEMA["angles"]
    headers = [h.strip() for h in ws.row_values(1) if h.strip()]

    if headers == expected:
        print("Schema already includes lead_magnet_path — nothing to migrate.")
        return

    if headers == expected[:-1]:
        target_col = len(expected)
        if ws.col_count < target_col:
            ws.add_cols(target_col - ws.col_count)
        cell = f"{col_letter(target_col)}1"
        ws.update(values=[["lead_magnet_path"]], range_name=cell)
        print(f"Added 'lead_magnet_path' header at {cell} (grid now {ws.col_count} cols).")
        return

    sys.exit(
        f"Schema drift — current headers don't match expected (minus lead_magnet_path).\n"
        f"  expected: {expected}\n"
        f"  got:      {headers}\n"
        f"Manual fix needed before migration."
    )


if __name__ == "__main__":
    main()
