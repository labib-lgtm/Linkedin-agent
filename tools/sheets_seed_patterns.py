"""One-time: seed the `patterns` tab with the P1–P6 winning patterns.

Read by `04_post_writer` so writing rules live in the Sheet, not duplicated
across markdown files.

Run: python3 tools/sheets_seed_patterns.py
"""
from __future__ import annotations

import sys

from sheets_client import SCHEMA, header_map, worksheet


PATTERNS = [
    {
        "pattern_id": "P1",
        "name": "Currency above the fold",
        "description": "$/€/£ amount in the first 250 chars (above LinkedIn mobile fold). Anchor in real client numbers.",
        "example_post_url": "https://www.linkedin.com/posts/labibjaved_2300-per-day-in-ad-spend-same-bids-at-activity-7450889519219826688-imG5",
        "active": "yes",
    },
    {
        "pattern_id": "P2",
        "name": "Two-line contradiction hook",
        "description": "Open with a setup line followed by a contradicting line. Pattern: <fact>. <subverting fact>. Optional 3rd: <stakes>.",
        "example_post_url": "https://www.linkedin.com/posts/labibjaved_we-doubled-the-budget-sales-barely-moved-activity-7449361325383692288-mBgr",
        "active": "yes",
    },
    {
        "pattern_id": "P3",
        "name": "Story arc, not a listicle",
        "description": "Single narrative — case → diagnosis → fix → number. Avoid Step 1/Step 2/Step 3 framework structure.",
        "example_post_url": "https://www.linkedin.com/posts/labibjaved_amazon-cannibilization-activity-7446780990250778624-gf_G",
        "active": "yes",
    },
    {
        "pattern_id": "P4",
        "name": "Two before/after numbers",
        "description": "At least two concrete metrics — CVR, ACoS, CTR, ROAS, %, ×. Before/after pair preferred (e.g. 'CVR 4.8% → 10.2%').",
        "example_post_url": "https://www.linkedin.com/posts/labibjaved_we-doubled-the-budget-sales-barely-moved-activity-7449361325383692288-mBgr",
        "active": "yes",
    },
    {
        "pattern_id": "P5",
        "name": "Lead-magnet CTA keyword",
        "description": "End with: 'Comment <ALL-CAPS-KEYWORD> and I'll send <asset>.' One word, all caps. No live link in the post body.",
        "example_post_url": "https://www.linkedin.com/posts/labibjaved_most-amazon-sellers-download-their-search-activity-7441943226837790720-22d4",
        "active": "yes",
    },
    {
        "pattern_id": "P6",
        "name": "Internal vocabulary (bonus)",
        "description": "Name the pattern you're describing — gives readers a phrase to repeat. e.g. 'internal cannibalization', 'match-type bleed', 'the 8% threshold rule'.",
        "example_post_url": "https://www.linkedin.com/posts/labibjaved_amazon-cannibilization-activity-7446780990250778624-gf_G",
        "active": "yes",
    },
]


def main() -> None:
    ws = worksheet("patterns")
    hm = header_map(ws)
    headers = SCHEMA["patterns"]
    existing_ids = set(ws.col_values(1)[1:])

    rows_to_append: list[list[str]] = []
    for p in PATTERNS:
        if p["pattern_id"] in existing_ids:
            print(f"  skip {p['pattern_id']} (already in sheet)")
            continue
        rows_to_append.append([p[col] for col in headers])
        print(f"  + {p['pattern_id']}: {p['name']}")

    if rows_to_append:
        ws.append_rows(rows_to_append, value_input_option="USER_ENTERED")
    print(f"\nSEEDED {len(rows_to_append)} pattern rows.")


if __name__ == "__main__":
    main()
