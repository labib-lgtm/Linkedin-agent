-- Migration 006: Multi-account scoping ("Book of Business")
--
-- Phase 2 of Compare v2. Lynx manages multiple LinkedIn presences (their
-- own + clients). Every primitive — competitors, posts, digests, angles
-- — gets scoped to an account_id. A default "Lynx Media" account
-- absorbs all existing rows so nothing breaks at deploy time.
--
-- Apply migration 005 first (is_self flag).

begin;

-- ---------------------------------------------------------------------------
-- accounts table
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  identifier text unique,             -- LinkedIn handle of the managed account (nullable)
  profile_url text,
  provider_id text,                   -- Cached Unipile ACo* id
  brand_color text default '#C6F21F',
  logo_url text,
  niche_tag text,                     -- For Phase 4 cross-account aggregation
  archived_at timestamptz,            -- soft delete
  created_at timestamptz not null default now()
);

create index if not exists accounts_active_idx
  on public.accounts (created_at desc) where archived_at is null;

-- Seed the default account if none exists yet. Idempotent — re-running
-- the migration won't create a second one.
insert into public.accounts (name, brand_color)
  select 'Lynx Media', '#C6F21F'
  where not exists (select 1 from public.accounts);

-- ---------------------------------------------------------------------------
-- Add account_id to scoped tables (nullable for now; backfill, then NOT NULL)
-- ---------------------------------------------------------------------------
alter table public.competitors
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.competitor_posts
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.creator_digests
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;
alter table public.angles
  add column if not exists account_id uuid references public.accounts(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Backfill — every existing row attaches to the first (default) account
-- ---------------------------------------------------------------------------
update public.competitors
   set account_id = (select id from public.accounts order by created_at asc limit 1)
 where account_id is null;
update public.competitor_posts
   set account_id = (select id from public.accounts order by created_at asc limit 1)
 where account_id is null;
update public.creator_digests
   set account_id = (select id from public.accounts order by created_at asc limit 1)
 where account_id is null;
update public.angles
   set account_id = (select id from public.accounts order by created_at asc limit 1)
 where account_id is null;

-- ---------------------------------------------------------------------------
-- Enforce NOT NULL after backfill
-- ---------------------------------------------------------------------------
alter table public.competitors alter column account_id set not null;
alter table public.competitor_posts alter column account_id set not null;
alter table public.creator_digests alter column account_id set not null;
alter table public.angles alter column account_id set not null;

-- ---------------------------------------------------------------------------
-- Phase 1's global "one self row" partial index becomes per-account
-- ---------------------------------------------------------------------------
drop index if exists competitors_one_self_idx;
create unique index if not exists competitors_one_self_per_account_idx
  on public.competitors (account_id, is_self) where is_self = true;

-- ---------------------------------------------------------------------------
-- Hot-path indexes
-- ---------------------------------------------------------------------------
create index if not exists competitors_account_idx on public.competitors (account_id);
create index if not exists competitor_posts_account_idx on public.competitor_posts (account_id);
create index if not exists angles_account_idx on public.angles (account_id);
create index if not exists creator_digests_account_idx on public.creator_digests (account_id);

-- creator_digests had a unique (week_start) constraint that's no longer
-- valid in a multi-account world — each account has its own weekly digest.
alter table public.creator_digests drop constraint if exists creator_digests_week_start_key;
create unique index if not exists creator_digests_account_week_idx
  on public.creator_digests (account_id, week_start);

commit;

notify pgrst, 'reload schema';
