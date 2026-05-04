"""Shared Google Sheets client.

Reads creds from .env (LYNX_GROWTH_PLAN_SHEET_ID, GOOGLE_OAUTH_CLIENT_PATH).
Auth via gspread.oauth() — first run opens a browser; refresh token cached at
GOOGLE_OAUTH_TOKEN_PATH (default ~/.config/gspread/authorized_user.json).

All sheet tools import from here so auth + retry + schema lookup stay in one place.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Iterable

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CLIENT_PATH = Path.home() / ".config" / "gspread" / "client_secret.json"
DEFAULT_TOKEN_PATH = Path.home() / ".config" / "gspread" / "authorized_user.json"

# Expected schema for every tab. Tools look up columns by header name (cached per
# run, not across runs). Mismatch → fail loud, never auto-repair.
SCHEMA: dict[str, list[str]] = {
    "angles": [
        # Identity + state
        "angle_id", "status", "pillar", "format",
        # Generation metadata
        "hook_seed", "cta_keyword", "winner_patterns", "gap_filled",
        # User-controlled
        "week_assigned", "notes",
        # Timestamps + URL
        "date_generated", "date_approved", "date_posted", "post_url",
        # Draft (Sheet is canonical — body lives here, not on disk)
        "hook_chosen", "hook_alternates", "draft_body", "critic_score",
        "slide_outline",
        # Audit
        "source_md",
        # Visual asset (path to generated PNG / PDF for this angle)
        "asset_path",
        # Image dimensions (only used when format=image; see normalize_image_size)
        "image_size",
        # Path to the rendered lead-magnet PDF for this angle (column W).
        # Phase B will add a sibling lead_magnet_url for the Drive/DUB link.
        "lead_magnet_path",
    ],
    "patterns": [
        "pattern_id", "name", "description", "example_post_url", "active",
    ],
    "killed_topics": [
        "killed_id", "topic_summary", "reason", "date_killed", "source_angle_id",
    ],
    "metrics": [
        "angle_id", "post_url", "impressions", "reactions", "comments",
        "reposts", "saves", "sends", "dwell_ratio", "verdict", "pulled_at",
    ],
}

STATUS_VALUES = [
    "Pending", "Approved", "Killed", "Drafting",
    "Drafted", "Visualizing", "Visual Ready",
    "Scheduled", "Posted", "Reviewed",
]
PILLAR_VALUES = ["PPC Operator", "Conversion Lab", "Agency Founder"]
FORMAT_VALUES = ["text", "carousel", "image", "video", "poll"]

# image_size column — friendly label -> raw dimensions sent to the image model.
# Empty value defaults to portrait (LinkedIn favors 4:5 in-feed). Raw 'WxH'
# strings pass through normalize_image_size verbatim.
IMAGE_SIZE_LABELS: dict[str, str] = {
    "portrait": "1024x1536",
    "square": "1024x1024",
    "landscape": "1536x1024",
}
DEFAULT_IMAGE_SIZE = "1024x1536"

import re as _re

_RAW_SIZE = _re.compile(r"^\d{3,5}x\d{3,5}$")


def normalize_image_size(value: str | None) -> str:
    """Map a Sheet image_size cell to a model-ready 'WxH' string.

    - Empty/None -> DEFAULT_IMAGE_SIZE (portrait).
    - Friendly labels (portrait/square/landscape) map via IMAGE_SIZE_LABELS.
    - Raw 'WxH' strings pass through (ASCII x or unicode × accepted).
    - Parenthetical annotations are stripped, e.g. '1024x1024 (square)' works.
    - Anything else raises ValueError with the accepted vocab.
    """
    raw = (value or "").strip().lower()
    # Drop annotations in parens: "1024x1024 (square)" -> "1024x1024"
    cleaned = _re.sub(r"\s*\([^)]*\)\s*", " ", raw).strip()
    # Normalize unicode multiplication sign / cross to ASCII x.
    cleaned = cleaned.replace("×", "x").replace("✕", "x")
    # Collapse internal whitespace.
    cleaned = _re.sub(r"\s+", "", cleaned)
    if not cleaned:
        return DEFAULT_IMAGE_SIZE
    if cleaned in IMAGE_SIZE_LABELS:
        return IMAGE_SIZE_LABELS[cleaned]
    if _RAW_SIZE.match(cleaned):
        return cleaned
    accepted = sorted(IMAGE_SIZE_LABELS.keys()) + ["<width>x<height> (e.g. 1024x1536)"]
    raise ValueError(
        f"image_size '{value}' is not recognized. "
        f"Accepted: {', '.join(accepted)}."
    )


def _load_env() -> dict[str, str]:
    env_path = PROJECT_ROOT / ".env"
    out: dict[str, str] = {}
    if not env_path.exists():
        return out
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


_ENV = _load_env()


def env(key: str, default: str | None = None) -> str:
    val = os.environ.get(key) or _ENV.get(key) or default
    if val is None:
        sys.exit(f"Missing env var: {key}")
    return val


def _expand(p: str | Path) -> Path:
    return Path(os.path.expanduser(str(p))).expanduser().resolve()


_CLIENT = None


def client():
    """Return an authorized gspread.Client. First call may open a browser."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    try:
        import gspread
    except ImportError:
        sys.exit("gspread not installed. Run: pip install -r tools/requirements.txt")

    client_path = _expand(env("GOOGLE_OAUTH_CLIENT_PATH", str(DEFAULT_CLIENT_PATH)))
    token_path = _expand(env("GOOGLE_OAUTH_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))

    if not client_path.exists():
        sys.exit(
            f"OAuth client secret not found at {client_path}.\n"
            f"Set up: GCP Console → OAuth Client (Desktop App) → download JSON →\n"
            f"save to that path, OR set GOOGLE_OAUTH_CLIENT_PATH in .env."
        )

    try:
        _CLIENT = gspread.oauth(
            credentials_filename=str(client_path),
            authorized_user_filename=str(token_path),
        )
    except Exception as e:
        sys.exit(
            f"OAuth failed: {e}\n"
            f"If token is invalid: delete {token_path} and re-run."
        )
    return _CLIENT


_SHEET = None


def sheet():
    """Return the Spreadsheet for LYNX_GROWTH_PLAN_SHEET_ID."""
    global _SHEET
    if _SHEET is not None:
        return _SHEET
    sheet_id = env("LYNX_GROWTH_PLAN_SHEET_ID")
    _SHEET = client().open_by_key(sheet_id)
    return _SHEET


def worksheet(name: str):
    """Return a Worksheet by tab name. Raises if missing."""
    try:
        return sheet().worksheet(name)
    except Exception as e:
        sys.exit(f"Worksheet '{name}' not found: {e}\nRun: python tools/sheets_init_workspace.py")


def header_map(ws) -> dict[str, int]:
    """Return {column_name: 1-based index}. Validates against SCHEMA."""
    headers = ws.row_values(1)
    expected = SCHEMA.get(ws.title)
    if expected is None:
        sys.exit(f"No schema defined for tab '{ws.title}'")
    actual_norm = [h.strip() for h in headers if h.strip()]
    if actual_norm[:len(expected)] != expected:
        sys.exit(
            f"Schema drift detected on '{ws.title}':\n"
            f"  expected: {expected}\n"
            f"  got:      {actual_norm}\n"
            f"Run: python tools/sheets_init_workspace.py to repair."
        )
    return {h: i + 1 for i, h in enumerate(headers) if h.strip()}


def safe_update(ws, updates: list[dict], retries: int = 4) -> None:
    """Wrap batch_update with exponential backoff on 429/500/503.

    Each update is a dict like {"range": "B5", "values": [["Drafting"]]}.
    """
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            ws.batch_update(updates)
            return
        except Exception as e:
            last_err = e
            msg = str(e)
            transient = any(code in msg for code in ("429", "500", "502", "503", "504"))
            if transient and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            raise
    raise RuntimeError(f"Sheets update failed after retries: {last_err}")


def find_row_by_id(ws, angle_id: str, id_col: int = 1) -> int | None:
    """Return 1-based row index for the given angle_id, or None if not found.

    Uses a single col_values() call to stay under quota.
    """
    col = ws.col_values(id_col)
    for i, v in enumerate(col, start=1):
        if v.strip() == angle_id:
            return i
    return None


def col_letter(n: int) -> str:
    """1 → A, 2 → B, 27 → AA, etc."""
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s
