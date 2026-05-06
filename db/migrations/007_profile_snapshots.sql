-- Migration 007: Profile snapshots + change detection
--
-- Phase 3 of Compare v2. Daily Trigger.dev worker captures every tracked
-- profile's headline, cover image, follower count, connection count.
-- Detects changes (text diff for headline, perceptual hash for cover,
-- milestones for followers) and inserts profile_change_events rows that
-- power the InsightBanner positioning-shifts card and the side-by-side
-- compare modal.
--
-- Requires migrations 005 + 006 applied first.

begin;

-- ---------------------------------------------------------------------------
-- competitor_snapshots: time series of profile state
-- ---------------------------------------------------------------------------
create table if not exists public.competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  headline text,
  cover_url text,                  -- Original LinkedIn CDN URL (rotates)
  cover_blockhash text,            -- 64-bit perceptual hash, hex (16 chars)
  cover_thumb_path text,           -- Path in Supabase Storage 'competitor-covers' bucket
  followers_count int,
  connections_count int,
  raw_profile jsonb                -- Full Unipile response for debugging
);

-- One snapshot per competitor per day. ::date cast keeps the unique
-- enforcement at calendar-day granularity, so re-running the snapshot
-- task within the same day upserts rather than duplicates.
create unique index if not exists competitor_snapshots_per_day_idx
  on public.competitor_snapshots (competitor_id, (captured_at::date));

create index if not exists competitor_snapshots_competitor_idx
  on public.competitor_snapshots (competitor_id, captured_at desc);

create index if not exists competitor_snapshots_account_idx
  on public.competitor_snapshots (account_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- profile_change_events: detected changes between consecutive snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.profile_change_events (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  detected_at timestamptz not null default now(),
  kind text not null check (kind in ('headline','cover','followers_milestone')),
  before_value text,
  after_value text,
  diff_score numeric               -- Hamming distance for cover, char distance for headline
);

create index if not exists profile_change_events_account_idx
  on public.profile_change_events (account_id, detected_at desc);

create index if not exists profile_change_events_competitor_idx
  on public.profile_change_events (competitor_id, detected_at desc);

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Storage bucket — run this manually in Supabase Storage UI or via the
-- Storage API. Migration files can't (cleanly) create buckets across all
-- Supabase versions, so it's a separate step:
--
--   bucket id:   competitor-covers
--   public:      true (read), service_role only for write
--   file size:   1 MB max
--   allowed types: image/jpeg, image/png, image/webp
-- ---------------------------------------------------------------------------
