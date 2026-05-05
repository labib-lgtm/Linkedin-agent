"""DEPRECATED — Sheet-schema migration, no longer needed.

The lead_magnet_recipients table is created by db/schema.sql for Supabase.
Apply db/schema.sql to a fresh Supabase project (one-time) and you're done.
"""
import sys

sys.exit(
    "This script is deprecated. The canonical schema lives in db/schema.sql; "
    "apply it to your Supabase project once via the SQL editor."
)
