"""One-shot migration: copy every row from the Google Sheet to Supabase.

Run this AFTER applying db/schema.sql to a fresh Supabase project and adding
SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to .env. Uses the existing gspread
OAuth (cached at ~/.config/gspread/) on the read side and the supabase-py
service-role client on the write side.

Idempotent: angles/patterns/killed_topics use upsert by primary key; metrics
use a composite (angle_id, pulled_at) PK so re-running is also safe;
lead_magnet_recipients use a unique index on comment_id so re-runs do not
double-insert.

Usage:
    python3 tools/migrate_sheet_to_supabase.py            # all tabs
    python3 tools/migrate_sheet_to_supabase.py --tab angles   # one tab
    python3 tools/migrate_sheet_to_supabase.py --dry-run  # show counts only
"""
from __future__ import annotations

import argparse
import sys
from typing import Any

import sheets_client
import supabase_client


# Map: Sheet tab name -> (Supabase table name, list of columns to copy)
# Columns are the Sheet header names; they map 1:1 to Supabase columns.
TAB_TO_TABLE: dict[str, tuple[str, list[str]]] = {
    "angles":                  ("angles",                  sheets_client.SCHEMA["angles"]),
    "patterns":                ("patterns",                sheets_client.SCHEMA["patterns"]),
    "killed_topics":           ("killed_topics",           sheets_client.SCHEMA["killed_topics"]),
    "metrics":                 ("metrics",                 sheets_client.SCHEMA["metrics"]),
    "lead_magnet_recipients":  ("lead_magnet_recipients",  sheets_client.SCHEMA["lead_magnet_recipients"]),
}

# Per-table conflict-resolution column for upsert.
ON_CONFLICT: dict[str, str] = {
    "angles":                  "angle_id",
    "patterns":                "pattern_id",
    "killed_topics":           "killed_id",
    "metrics":                 "angle_id,pulled_at",
}

# Columns that must be cast from Sheet text to integers/numerics/booleans
# before sending to Supabase. Empty strings become NULL.
INT_COLS = {"impressions", "reactions", "comments", "reposts", "saves", "sends"}
NUMERIC_COLS = {"dwell_ratio"}
BOOL_COLS = {"active"}


def _coerce(col: str, raw: str) -> Any:
    """Convert a Sheet cell value to the right Python type for Supabase."""
    s = (raw or "").strip()
    if s == "":
        return None
    if col in INT_COLS:
        try:
            return int(s.replace(",", ""))
        except ValueError:
            return None
    if col in NUMERIC_COLS:
        try:
            return float(s)
        except ValueError:
            return None
    if col in BOOL_COLS:
        return s.lower() in {"true", "yes", "1", "y", "t"}
    return s


def _row_to_dict(headers: list[str], cols: list[str], row: list[str]) -> dict[str, Any]:
    """Build a dict for the Supabase columns we care about."""
    out: dict[str, Any] = {}
    by_idx = {h: i for i, h in enumerate(headers) if h.strip()}
    for col in cols:
        idx = by_idx.get(col)
        if idx is None:
            continue
        raw = row[idx] if idx < len(row) else ""
        out[col] = _coerce(col, raw)
    return out


def _migrate_tab(tab: str, dry_run: bool = False) -> tuple[int, int]:
    table, cols = TAB_TO_TABLE[tab]
    ws = sheets_client.worksheet(tab)
    all_rows = ws.get_all_values()
    if len(all_rows) < 2:
        print(f"  {tab}: no data rows")
        return (0, 0)

    headers = all_rows[0]
    body = all_rows[1:]
    sheet_count = sum(1 for r in body if any((c or "").strip() for c in r))

    print(f"  {tab}: {sheet_count} non-empty rows in Sheet → table '{table}'")

    if dry_run:
        return (sheet_count, 0)

    # Build payload, skipping fully-empty rows.
    payload = [
        _row_to_dict(headers, cols, row)
        for row in body
        if any((c or "").strip() for c in row)
    ]

    # Drop rows missing the primary-key column (defensive).
    pk_col = ON_CONFLICT.get(table, "").split(",")[0] or cols[0]
    payload = [p for p in payload if p.get(pk_col)]

    if not payload:
        print(f"    skipped (no rows had a {pk_col})")
        return (sheet_count, 0)

    sb = supabase_client.client()
    on_conflict = ON_CONFLICT.get(table)

    # Chunk to keep request bodies small.
    CHUNK = 200
    inserted = 0
    for i in range(0, len(payload), CHUNK):
        batch = payload[i : i + CHUNK]
        if on_conflict is not None:
            sb.table(table).upsert(batch, on_conflict=on_conflict).execute()
        else:
            # No PK to upsert on (lead_magnet_recipients); insert and let the
            # unique-on-comment_id index reject duplicates.
            try:
                sb.table(table).insert(batch).execute()
            except Exception as e:
                # Duplicate-key on re-run is expected for this table; surface
                # other errors loudly.
                if "duplicate key" not in str(e).lower():
                    raise
        inserted += len(batch)
        print(f"    {inserted}/{len(payload)} written")

    return (sheet_count, inserted)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--tab",
        choices=list(TAB_TO_TABLE.keys()) + ["all"],
        default="all",
        help="which tab to migrate (default: all)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="print row counts only, do not write to Supabase",
    )
    args = ap.parse_args()

    print(f"Source Sheet:   {sheets_client.env('LYNX_GROWTH_PLAN_SHEET_ID')}")
    print(f"Target project: {supabase_client.env('SUPABASE_URL')}")
    print()

    tabs = list(TAB_TO_TABLE.keys()) if args.tab == "all" else [args.tab]
    grand_sheet = grand_supa = 0

    for tab in tabs:
        try:
            sheet_n, supa_n = _migrate_tab(tab, dry_run=args.dry_run)
        except Exception as e:
            print(f"  {tab}: FAILED — {e}", file=sys.stderr)
            return 2
        grand_sheet += sheet_n
        grand_supa += supa_n

    print()
    if args.dry_run:
        print(f"Dry run done. {grand_sheet} rows would migrate.")
    else:
        print(f"Migration done. {grand_supa}/{grand_sheet} rows written.")
        if grand_supa != grand_sheet:
            print(
                "WARN: counts diverge. Re-running is safe (upsert), but check "
                "rows missing primary keys in the source Sheet.",
                file=sys.stderr,
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
