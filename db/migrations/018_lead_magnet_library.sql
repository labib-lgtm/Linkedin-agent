-- Migration 018: lead magnet library — reusable assets for comment-driver DMs
--
-- Today every angle stores its own one-off `lead_magnet_url` (which has
-- never even been writable from the UI). Operators want to define a magnet
-- once ("Conversion Audit Framework") and reuse it across every post that
-- promises it. This migration adds:
--
--   1. lead_magnets table (per-account library, link OR file)
--   2. angles.lead_magnet_id (FK so analytics + relinking is possible)
--
-- Phase F engagement loop is unchanged: it still substitutes
-- {{lead_magnet_url}} from the angle row directly. The picker UI just
-- writes lead_magnet_url onto the angle when the operator selects a
-- library entry — runtime lookups stay zero-join.
--
-- MANUAL OPS: after applying this migration, create a public-read storage
-- bucket named `lead-magnets` in the Supabase dashboard (same way
-- post-assets and competitor-covers were created — there's no SQL helper
-- for bucket creation in this repo). DM recipients open the URL without
-- auth, so the bucket must be public.
--
-- Requires migrations 011-017 applied first.

begin;

create table if not exists public.lead_magnets (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  label       text not null,
  kind        text not null check (kind in ('link', 'file')),
  url         text not null,                       -- for 'link': the URL itself; for 'file': the bucket public URL
  file_path   text,                                -- storage key inside lead-magnets bucket; null for 'link'
  description text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,
  check ((kind = 'link' and file_path is null) or (kind = 'file' and file_path is not null))
);

create index if not exists lead_magnets_account_idx
  on public.lead_magnets (account_id, archived_at);

alter table public.angles
  add column if not exists lead_magnet_id uuid
  references public.lead_magnets(id) on delete set null;

create index if not exists angles_lead_magnet_idx
  on public.angles (lead_magnet_id);

commit;

notify pgrst, 'reload schema';
