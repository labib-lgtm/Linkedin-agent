-- Migration 030: Audience intelligence + outbound tracking + competitor engagers
--
-- Companion tables for the /audience section. Pivots the tool toward pure
-- audience intelligence: connections + followers demographics, invitation
-- state tracking, target segments with gap analysis, and competitor engager
-- mining for prospect suggestions.
--
-- Nothing here drops or alters existing tables — the posting-side schema
-- (angles, competitor_posts, client_reports, etc.) is preserved so those
-- features can be re-enabled later by reverting the nav + cron changes.
--
-- Requires migrations 001-029 applied.

begin;

-- ---------------------------------------------------------------------------
-- audience_connections: one row per current 1st-degree connection
-- ---------------------------------------------------------------------------
-- Populated by trigger/scan_audience.ts. walkAllRelations() drives the outer
-- loop; getUserProfileLite() per relation lands the per-profile fields.
-- Unique on (account_id, provider_id) so re-scans upsert cleanly.

create table if not exists public.audience_connections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_id text not null,          -- Unipile / LinkedIn "ACo..." member urn
  public_identifier text,             -- vanity slug from /in/<slug>
  full_name text,
  headline text,
  location text,                      -- Raw location string as Unipile returns it
  city text,                          -- Best-effort split from location
  country text,
  industry text,
  current_company text,
  job_title text,                  -- Job title / occupation
  profile_url text,
  raw jsonb,                          -- Full Unipile profile response for future re-extraction
  first_seen_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  unique (account_id, provider_id)
);

create index if not exists audience_connections_account_idx
  on public.audience_connections (account_id);
create index if not exists audience_connections_country_idx
  on public.audience_connections (account_id, country) where country is not null;
create index if not exists audience_connections_industry_idx
  on public.audience_connections (account_id, industry) where industry is not null;

-- ---------------------------------------------------------------------------
-- audience_followers: one row per follower discovered via Voyager pass-through
-- ---------------------------------------------------------------------------
-- Same shape as audience_connections but sourced from LinkedIn's internal
-- profileMemberFollowers Voyager endpoint (via Unipile /api/v1/linkedin
-- raw-data pass-through). Ban-risk-gated — Phase A rollout ships with a
-- hard budget cap of 10 followers per scan; only after 24-48h of clean
-- account state do we raise to 100, then to full walks.

create table if not exists public.audience_followers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_id text not null,
  public_identifier text,
  full_name text,
  headline text,
  location text,
  city text,
  country text,
  industry text,
  current_company text,
  job_title text,
  profile_url text,
  raw jsonb,
  discovered_at timestamptz not null default now(),
  last_scanned_at timestamptz not null default now(),
  unique (account_id, provider_id)
);

create index if not exists audience_followers_account_idx
  on public.audience_followers (account_id);
create index if not exists audience_followers_country_idx
  on public.audience_followers (account_id, country) where country is not null;

-- ---------------------------------------------------------------------------
-- audience_scans: audit log for scan runs (connections + followers)
-- ---------------------------------------------------------------------------
-- Mirrors pakistan_cleanup_scans (migration 029). One row per Trigger.dev
-- run. Lets the UI show "last scanned N days ago" and surface failures.

create table if not exists public.audience_scans (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  scan_type text not null check (scan_type in ('connections', 'followers')),
  run_id text,                        -- Trigger.dev run id
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  total_walked int not null default 0,
  matches_upserted int not null default 0,
  budget int,                         -- For follower scans: caller-supplied budget cap
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists audience_scans_account_started_idx
  on public.audience_scans (account_id, started_at desc);

-- ---------------------------------------------------------------------------
-- own_account_snapshots: daily point-in-time for our own profile
-- ---------------------------------------------------------------------------
-- Mirrors competitor_snapshots (migration 007) but for our own account.
-- Powers the "audience over time" chart in Tab 1. Populated daily by
-- trigger/snapshot_own_account.ts at 04:00 UTC.

create table if not exists public.own_account_snapshots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  headline text,
  picture_url text,
  followers_count int,
  connections_count int,
  raw_profile jsonb
);

create index if not exists own_account_snapshots_account_idx
  on public.own_account_snapshots (account_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- outgoing_invitations: every connection request sent from the app
-- ---------------------------------------------------------------------------
-- Written by the existing send-prospect-invites task (as a mirror alongside
-- prospect_outreach) AND by any new /audience Tab 3 enqueue action. Status
-- transitions:
--    sent      -> initial state right after Unipile POST /users/invite succeeds
--    pending   -> after track-outgoing-invitations verifies no immediate accept
--                 (typically same run — "pending" and "sent" are the same
--                 network reality; we split them so the UI can highlight
--                 truly stale ones)
--    accepted  -> track-outgoing-invitations saw the provider_id in relations
--    withdrawn -> operator clicked Withdraw (Unipile cancel-invite call succeeded)
--    expired   -> sent_at + 14d elapsed AND still pending; UI auto-flags
--                 for withdraw before LinkedIn spam-tags the account.

create table if not exists public.outgoing_invitations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider_id text not null,
  full_name text,
  headline text,
  note text,                          -- Connection note we sent
  status text not null default 'sent'
    check (status in ('sent', 'pending', 'accepted', 'withdrawn', 'expired')),
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  withdrawn_at timestamptz,
  withdraw_reason text,
  linked_prospect_outreach_id uuid references public.prospect_outreach(id) on delete set null,
  segment_id uuid,                    -- FK set once target_segments exists; keep loose here
  raw jsonb,                          -- Unipile invitation response for cross-ref
  updated_at timestamptz not null default now(),
  unique (account_id, provider_id, sent_at)
);

create index if not exists outgoing_invitations_account_status_idx
  on public.outgoing_invitations (account_id, status);
create index if not exists outgoing_invitations_account_sent_idx
  on public.outgoing_invitations (account_id, sent_at desc);
create index if not exists outgoing_invitations_stale_idx
  on public.outgoing_invitations (account_id, sent_at)
  where status in ('sent', 'pending');

-- ---------------------------------------------------------------------------
-- target_segments: user-defined targeting criteria
-- ---------------------------------------------------------------------------
-- Composed in Tab 3's segment modal. Filters get applied against
-- audience_connections for gap analysis and against competitor_engagers
-- for prospect suggestions. Array columns keep the filter shape simple —
-- caller applies OR-within-array, AND-across-columns semantics.

create table if not exists public.target_segments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  industries text[] not null default '{}',
  role_keywords text[] not null default '{}',
  locations text[] not null default '{}',
  company_size_min int,
  company_size_max int,
  notes text,
  weekly_quota int not null default 20,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, name)
);

create index if not exists target_segments_account_idx
  on public.target_segments (account_id)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- competitor_engagers: deduped people who engaged with competitor content
-- ---------------------------------------------------------------------------
-- Populated by trigger/mine_competitor_engagers.ts. One row per unique
-- (competitor_id, provider_id) — future engagements bump the last-seen
-- timestamp and append to signal history rather than duplicating.
-- matched_segment_ids is an array so a single engager can hit multiple
-- segments; the mine task runs the segment-match join inline so Tab 3
-- can filter with a single ARRAY[segment_id] @> operator.

create table if not exists public.competitor_engagers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  provider_id text not null,
  public_identifier text,
  full_name text,
  headline text,
  location text,
  city text,
  country text,
  industry text,
  current_company text,
  job_title text,
  profile_url text,
  signal_type text not null check (signal_type in ('comment', 'reaction', 'both')),
  first_post_id text,                 -- The post that surfaced them first
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  matched_segment_ids uuid[] not null default '{}',
  raw jsonb,
  unique (account_id, competitor_id, provider_id)
);

create index if not exists competitor_engagers_account_idx
  on public.competitor_engagers (account_id);
create index if not exists competitor_engagers_competitor_idx
  on public.competitor_engagers (competitor_id, last_seen_at desc);
-- GIN index so Tab 3's "engagers matching segment X" query stays cheap
-- as the table grows (array containment can't use a btree).
create index if not exists competitor_engagers_segments_idx
  on public.competitor_engagers using gin (matched_segment_ids);

commit;

notify pgrst, 'reload schema';
