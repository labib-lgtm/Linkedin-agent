"""One-time schema bootstrap for the LinkedIn agent's Google Sheet workspace.

Creates 4 tabs (angles, patterns, killed_topics, metrics), writes headers,
applies dropdown validation on `angles.status` / `pillar` / `format`,
freezes the header row, and applies conditional formatting on status.

Idempotent: re-runnable. If a tab exists with matching headers, it's skipped.
If a tab exists with mismatched headers, fails loud (no silent overwrite).

Run: python3 tools/sheets_init_workspace.py
"""
from __future__ import annotations

import sys
from typing import Any

from sheets_client import (
    SCHEMA, STATUS_VALUES, PILLAR_VALUES, FORMAT_VALUES,
    sheet, col_letter,
)


def ensure_worksheet(ss, name: str, headers: list[str]) -> tuple[Any, bool]:
    """Return (worksheet, created_flag). Fails loud on header mismatch."""
    try:
        ws = ss.worksheet(name)
    except Exception:
        ws = ss.add_worksheet(title=name, rows=1000, cols=max(20, len(headers) + 4))
        ws.update(values=[headers], range_name="A1")
        ws.freeze(rows=1)
        return ws, True

    actual = [h.strip() for h in ws.row_values(1) if h.strip()]
    if actual == headers:
        return ws, False
    if not actual:
        ws.update(values=[headers], range_name="A1")
        ws.freeze(rows=1)
        return ws, True
    sys.exit(
        f"Tab '{name}' exists but headers don't match.\n"
        f"  expected: {headers}\n"
        f"  got:      {actual}\n"
        f"Manual fix needed — refusing to overwrite existing data."
    )


def apply_dropdown(ws, col_name: str, values: list[str]) -> None:
    """Apply data validation (dropdown) to a column starting at row 2."""
    headers = ws.row_values(1)
    try:
        col_idx = headers.index(col_name) + 1
    except ValueError:
        return
    letter = col_letter(col_idx)
    range_a1 = f"{letter}2:{letter}1000"
    rule_body = {
        "requests": [{
            "setDataValidation": {
                "range": {
                    "sheetId": ws.id,
                    "startRowIndex": 1,
                    "endRowIndex": 1000,
                    "startColumnIndex": col_idx - 1,
                    "endColumnIndex": col_idx,
                },
                "rule": {
                    "condition": {
                        "type": "ONE_OF_LIST",
                        "values": [{"userEnteredValue": v} for v in values],
                    },
                    "showCustomUi": True,
                    "strict": False,
                },
            }
        }]
    }
    ws.spreadsheet.batch_update(rule_body)


def apply_status_conditional_formatting(ws) -> None:
    """Color-code the status column. Light shades, easy on the eyes."""
    headers = ws.row_values(1)
    try:
        col_idx = headers.index("status") + 1
    except ValueError:
        return

    color_map = {
        "Pending":   {"red": 0.96, "green": 0.96, "blue": 0.96},
        "Approved":  {"red": 0.85, "green": 0.96, "blue": 0.85},
        "Killed":    {"red": 0.98, "green": 0.85, "blue": 0.85},
        "Drafting":  {"red": 0.93, "green": 0.93, "blue": 0.99},
        "Drafted":   {"red": 0.85, "green": 0.92, "blue": 0.99},
        "Scheduled": {"red": 0.99, "green": 0.96, "blue": 0.82},
        "Posted":    {"red": 0.78, "green": 0.93, "blue": 0.78},
        "Reviewed":  {"red": 0.86, "green": 0.86, "blue": 0.95},
    }

    requests = []
    for status, color in color_map.items():
        requests.append({
            "addConditionalFormatRule": {
                "rule": {
                    "ranges": [{
                        "sheetId": ws.id,
                        "startRowIndex": 1,
                        "endRowIndex": 1000,
                        "startColumnIndex": col_idx - 1,
                        "endColumnIndex": col_idx,
                    }],
                    "booleanRule": {
                        "condition": {
                            "type": "TEXT_EQ",
                            "values": [{"userEnteredValue": status}],
                        },
                        "format": {"backgroundColor": color},
                    },
                },
                "index": 0,
            }
        })
    ws.spreadsheet.batch_update({"requests": requests})


def main() -> None:
    ss = sheet()
    print(f"Spreadsheet: {ss.title} ({ss.id})", file=sys.stderr)

    summary: dict[str, str] = {}

    for tab_name, headers in SCHEMA.items():
        ws, created = ensure_worksheet(ss, tab_name, headers)
        summary[tab_name] = "created" if created else "exists"

        if tab_name == "angles":
            apply_dropdown(ws, "status", STATUS_VALUES)
            apply_dropdown(ws, "pillar", PILLAR_VALUES)
            apply_dropdown(ws, "format", FORMAT_VALUES)
            apply_status_conditional_formatting(ws)

    # Delete the default empty 'Sheet1' if it's still hanging around
    for ws in ss.worksheets():
        if ws.title == "Sheet1" and ws.row_count and not ws.row_values(1):
            try:
                ss.del_worksheet(ws)
                summary["Sheet1"] = "deleted (was empty default)"
            except Exception as e:
                print(f"Could not delete Sheet1: {e}", file=sys.stderr)

    print("\nINIT COMPLETE")
    for k, v in summary.items():
        print(f"  {k}: {v}")
    print(f"\nSheet URL: https://docs.google.com/spreadsheets/d/{ss.id}/edit")


if __name__ == "__main__":
    main()
