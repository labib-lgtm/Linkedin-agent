"""Supabase client — replaces sheets_client.py as the canonical state store.

Reads creds from .env:
    SUPABASE_URL              — project URL (https://<ref>.supabase.co)
    SUPABASE_SERVICE_ROLE_KEY — service-role key (server-side, bypasses RLS)

Server-side tools (Python + Trigger.dev) use the service-role key so RLS
policies do not gate writes. The webapp uses the anon key + Supabase Auth.

Public interface (record-oriented; replaces gspread worksheet API):

    Angles
    ------
        get_angle(angle_id) -> dict | None
        read_angles(status=None, limit=None) -> list[dict]
        update_angle(angle_id, fields)
        upsert_angle(fields)
        update_status(angle_id, status)

    Lead-magnet recipients
    ----------------------
        insert_recipient(fields) -> dict (returns row incl. recipient_id)
        update_recipient(recipient_id, fields)
        find_recipient_by_comment(comment_id) -> dict | None

    Audit log
    ---------
        insert_audit_event(angle_id, event_type, payload=None)

    Generic
    -------
        read_table(table, **filters) -> list[dict]
        insert_row(table, fields) -> dict

Constants preserved from sheets_client (so importers do not break):
    STATUS_VALUES, PILLAR_VALUES, FORMAT_VALUES,
    IMAGE_SIZE_LABELS, DEFAULT_IMAGE_SIZE, normalize_image_size
"""
from __future__ import annotations

import os
import re as _re
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Constants (kept identical to sheets_client so import-swap tools still work)
# ---------------------------------------------------------------------------
STATUS_VALUES = [
    "Pending", "Approved", "Killed", "Drafting",
    "Drafted", "Visualizing", "Visual Ready",
    "Scheduled", "Posted", "Reviewed",
]
PILLAR_VALUES = ["PPC Operator", "Conversion Lab", "Agency Founder"]
FORMAT_VALUES = ["text", "carousel", "image", "video", "poll"]

IMAGE_SIZE_LABELS: dict[str, str] = {
    "portrait":  "1024x1536",
    "square":    "1024x1024",
    "landscape": "1536x1024",
}
DEFAULT_IMAGE_SIZE = "1024x1536"

_RAW_SIZE = _re.compile(r"^\d{3,5}x\d{3,5}$")


def normalize_image_size(value: str | None) -> str:
    """Map a raw image_size value to a model-ready 'WxH' string.

    Identical behavior to sheets_client.normalize_image_size.
    """
    raw = (value or "").strip().lower()
    cleaned = _re.sub(r"\s*\([^)]*\)\s*", " ", raw).strip()
    cleaned = cleaned.replace("×", "x").replace("✕", "x")
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


# ---------------------------------------------------------------------------
# .env loader (mirrors sheets_client._load_env so tools without dotenv work)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Supabase client (lazy, single instance)
# ---------------------------------------------------------------------------
_CLIENT = None


def client():
    """Return an authorized supabase Client using the service-role key."""
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT
    try:
        from supabase import create_client
    except ImportError:
        sys.exit(
            "supabase not installed. Run: "
            "pip install -r tools/requirements.txt"
        )

    url = env("SUPABASE_URL")
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    _CLIENT = create_client(url, key)
    return _CLIENT


# ---------------------------------------------------------------------------
# Angles
# ---------------------------------------------------------------------------
def get_angle(angle_id: str) -> dict | None:
    """Return the angle row as a dict, or None if not found."""
    res = (
        client()
        .table("angles")
        .select("*")
        .eq("angle_id", angle_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def read_angles(
    status: str | None = None,
    week_assigned: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Return all angles, optionally filtered, ordered by angle_id ascending."""
    q = client().table("angles").select("*")
    if status is not None:
        q = q.eq("status", status)
    if week_assigned is not None:
        q = q.eq("week_assigned", week_assigned)
    q = q.order("angle_id")
    if limit is not None:
        q = q.limit(limit)
    return (q.execute().data) or []


def update_angle(angle_id: str, fields: dict[str, Any]) -> None:
    """Patch one or more fields on an angle. Exits if angle_id not found."""
    if not fields:
        return
    res = (
        client()
        .table("angles")
        .update(fields)
        .eq("angle_id", angle_id)
        .execute()
    )
    if not res.data:
        sys.exit(f"angle_id '{angle_id}' not found in Supabase angles table")


def upsert_angle(fields: dict[str, Any]) -> dict:
    """Insert or update by angle_id (the primary key). Returns the row."""
    if "angle_id" not in fields:
        sys.exit("upsert_angle requires 'angle_id' in fields")
    res = (
        client()
        .table("angles")
        .upsert(fields, on_conflict="angle_id")
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else dict(fields)


def update_status(angle_id: str, status: str) -> None:
    """Convenience: flip status field. Validates against STATUS_VALUES."""
    if status not in STATUS_VALUES:
        sys.exit(
            f"Invalid status '{status}'. Must be one of: {STATUS_VALUES}"
        )
    update_angle(angle_id, {"status": status})


# ---------------------------------------------------------------------------
# Lead-magnet recipients
# ---------------------------------------------------------------------------
def insert_recipient(fields: dict[str, Any]) -> dict:
    """Insert a recipient row. Returns the inserted row incl. recipient_id."""
    res = (
        client()
        .table("lead_magnet_recipients")
        .insert(fields)
        .execute()
    )
    rows = res.data or []
    if not rows:
        sys.exit("insert_recipient returned no rows")
    return rows[0]


def update_recipient(recipient_id: str, fields: dict[str, Any]) -> None:
    """Patch fields on a recipient row. Silent if recipient_id missing."""
    if not fields:
        return
    (
        client()
        .table("lead_magnet_recipients")
        .update(fields)
        .eq("recipient_id", recipient_id)
        .execute()
    )


def find_recipient_by_comment(comment_id: str) -> dict | None:
    """Return the recipient row for a given comment_id, or None if absent."""
    res = (
        client()
        .table("lead_magnet_recipients")
        .select("*")
        .eq("comment_id", comment_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------
def insert_audit_event(
    angle_id: str | None,
    event_type: str,
    payload: dict[str, Any] | None = None,
) -> None:
    """Append an event to audit_log."""
    (
        client()
        .table("audit_log")
        .insert({
            "angle_id":   angle_id,
            "event_type": event_type,
            "payload":    payload or {},
        })
        .execute()
    )


# ---------------------------------------------------------------------------
# Generic helpers (low-volume tables: patterns, killed_topics, metrics)
# ---------------------------------------------------------------------------
def read_table(table: str, **filters: Any) -> list[dict]:
    """Generic read: equality filters as kwargs, returns all matching rows."""
    q = client().table(table).select("*")
    for col, val in filters.items():
        q = q.eq(col, val)
    return (q.execute().data) or []


def insert_row(table: str, fields: dict[str, Any]) -> dict:
    """Generic insert. Returns the inserted row."""
    res = client().table(table).insert(fields).execute()
    rows = res.data or []
    if not rows:
        sys.exit(f"insert_row({table}) returned no rows")
    return rows[0]
