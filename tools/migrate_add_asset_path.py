"""One-shot migration: add `asset_path` as column U on the angles tab.

Idempotent. If asset_path is already there, exits cleanly.

Run: python3 tools/migrate_add_asset_path.py
"""
from __future__ import annotations

import sys

from sheets_client import SCHEMA, sheet, worksheet, col_letter


def main() -> None:
    ws = worksheet("angles")
    expected = SCHEMA["angles"]
    headers = [h.strip() for h in ws.row_values(1) if h.strip()]

    if headers == expected:
        print("Schema already includes asset_path — nothing to migrate.")
        return

    if headers == expected[:-1]:
        # Common case: schema is one column short, just append asset_path.
        # Sheet may have been created with col_count=len(headers); expand if needed.
        target_col = len(expected)  # 1-based; new column is the new last
        if ws.col_count < target_col:
            ws.add_cols(target_col - ws.col_count)
        cell = f"{col_letter(target_col)}1"
        ws.update(values=[["asset_path"]], range_name=cell)
        print(f"Added 'asset_path' header at {cell} (grid now {ws.col_count} cols).")
        return

    sys.exit(
        f"Schema drift — current headers don't match expected (minus asset_path).\n"
        f"  expected: {expected}\n"
        f"  got:      {headers}\n"
        f"Manual fix needed before migration."
    )


if __name__ == "__main__":
    main()
