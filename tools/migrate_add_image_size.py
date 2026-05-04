"""One-shot migration: add `image_size` as column V on the angles tab.

Idempotent. If image_size is already there, exits cleanly. Mirrors the shape
of migrate_add_asset_path.py.

Run: python3 tools/migrate_add_image_size.py
"""
from __future__ import annotations

import sys

from sheets_client import SCHEMA, worksheet, col_letter


def main() -> None:
    ws = worksheet("angles")
    expected = SCHEMA["angles"]
    headers = [h.strip() for h in ws.row_values(1) if h.strip()]

    if headers == expected:
        print("Schema already includes image_size — nothing to migrate.")
        return

    if headers == expected[:-1]:
        target_col = len(expected)
        if ws.col_count < target_col:
            ws.add_cols(target_col - ws.col_count)
        cell = f"{col_letter(target_col)}1"
        ws.update(values=[["image_size"]], range_name=cell)
        print(f"Added 'image_size' header at {cell} (grid now {ws.col_count} cols).")
        return

    sys.exit(
        f"Schema drift — current headers don't match expected (minus image_size).\n"
        f"  expected: {expected}\n"
        f"  got:      {headers}\n"
        f"Manual fix needed before migration."
    )


if __name__ == "__main__":
    main()
