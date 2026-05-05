"""DEPRECATED — Sheet workspace bootstrap, no longer needed.

The canonical store is now Supabase, not Google Sheets. The schema is
defined once in db/schema.sql; apply it to a fresh Supabase project via
the SQL editor.
"""
import sys

sys.exit(
    "This script is deprecated. The canonical schema lives in db/schema.sql; "
    "apply it to your Supabase project once via the SQL editor."
)
