-- 029 — Pakistan connection cleanup.
--
-- User (Labib) wants to remove every LinkedIn connection whose location is
-- anywhere in Pakistan. Unipile does NOT expose a disconnect endpoint, so
-- automating this server-side would require abusing their raw-data
-- pass-through against LinkedIn's internal Voyager API — a bulk-disconnect
-- pattern that LinkedIn's automation guards routinely flag and restrict.
-- Given the account is a business asset (Lynx Media inbound flow), the
-- safer approach is:
--   1. Discovery: Trigger.dev task fetches every connection via Unipile,
--      per-profile location lookup, filters to Pakistan, persists here.
--   2. Manual removal: operator clicks through the list in the webapp tab;
--      each row opens the LinkedIn profile UI in a new tab, operator does
--      the 3-click removal, then hits "Mark removed" in the tab. Full audit
--      trail. Zero ban risk.
--
-- Location match rule: Unipile profile.location is a plain string like
-- "Lahore, Punjab, Pakistan" or "Karachi, Sindh". We match on
-- country/city keywords case-insensitively in the discovery task, and store
-- the matched keyword here so the UI can show WHY each row was flagged.

create table if not exists public.pakistan_cleanup_targets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- Unipile identifiers. provider_id is the canonical member key we use to
  -- resolve back to LinkedIn URLs; public_identifier is the vanity slug.
  provider_id text not null,
  public_identifier text,
  -- Snapshot of the profile at scan time. LinkedIn profiles change; we keep
  -- what we saw so the UI stays consistent even if the profile is later
  -- deleted or updated.
  full_name text,
  headline text,
  location text,
  matched_keyword text,               -- which keyword flagged this row
  profile_url text,                   -- linkedin.com/in/<slug>/ if we have it
  -- Operator workflow state.
  status text not null default 'pending'
    check (status in ('pending', 'removed', 'skipped')),
  removed_at timestamptz,
  skipped_reason text,
  -- Housekeeping.
  scanned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, provider_id)
);

create index if not exists pakistan_cleanup_targets_account_status_idx
  on public.pakistan_cleanup_targets (account_id, status);
create index if not exists pakistan_cleanup_targets_scanned_at_idx
  on public.pakistan_cleanup_targets (scanned_at desc);

-- Scan-run log so the operator can see when the last full pass ran and
-- whether it completed cleanly. One row per Trigger.dev run.
create table if not exists public.pakistan_cleanup_scans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  run_id text,                        -- Trigger.dev run id for cross-ref
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  total_relations int,                -- how many connections Unipile returned
  profiles_fetched int not null default 0,
  matches_found int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists pakistan_cleanup_scans_account_started_idx
  on public.pakistan_cleanup_scans (account_id, started_at desc);
