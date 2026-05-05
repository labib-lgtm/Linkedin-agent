"""DEPRECATED — Sheet-schema migration, no longer needed.

Schema is now defined in db/schema.sql for Supabase. This script existed only
to migrate the legacy Google Sheet's column layout. Apply db/schema.sql to a
fresh Supabase project (one-time) and you're done.
"""
import sys

sys.exit(
    "This script is deprecated. The canonical schema lives in db/schema.sql; "
    "apply it to your Supabase project once via the SQL editor."
)
