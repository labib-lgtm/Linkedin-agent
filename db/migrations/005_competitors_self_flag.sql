-- Migration 005: Add is_self flag to competitors
--
-- Phase 1 of Compare v2. Marks one competitor row as "self" (Lynx Media's
-- own LinkedIn profile, tracked alongside competitors). The leaderboard
-- pins this row as the baseline; every other competitor shows deltas
-- against it.
--
-- A partial unique index enforces "at most one self row at a time".
-- Phase 2 rescopes this to per-account when accounts get introduced.

begin;

alter table public.competitors
  add column if not exists is_self boolean not null default false;

create unique index if not exists competitors_one_self_idx
  on public.competitors (is_self) where is_self = true;

commit;

notify pgrst, 'reload schema';
