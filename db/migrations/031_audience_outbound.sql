-- Migration 031: Audience outbound engine
--
-- Wires the audience-side segment machinery into the existing outreach queue.
-- Adds per-segment templates + fail-closed controls to target_segments,
-- relaxes prospects.seller_id so audience-sourced rows (no seller) can live
-- in the same queue the Amazon-seller pipeline uses, and adds a source
-- discriminator so the two paths stay separable for reporting.
--
-- Once applied, the daily source-audience-candidates task can enqueue
-- competitor_engagers rows matching an active segment into prospect_outreach
-- with stage='ready_to_invite'+invite_approved=true, and the existing hourly
-- send-prospect-invites cron sends them at the daily cap (bumped to 30 in
-- code to accommodate both pipelines).
--
-- Requires migrations 020, 022, and 030 applied.

begin;

-- ---------------------------------------------------------------------------
-- prospects — accept audience-sourced rows (no seller FK)
-- ---------------------------------------------------------------------------
-- seller_id was NOT NULL because every prospect came from a CSV import.
-- Audience rows have no seller; drop the NOT NULL. Existing rows keep
-- their seller_id set. The old `unique (seller_id, provider_id)` composite
-- can't stay because two audience rows with different accounts + same
-- provider_id (both with seller_id=NULL) would collide under the SQL null
-- semantics (Postgres treats each NULL as distinct in a unique, so it
-- actually still works, but this is a footgun we'd rather not leave).
-- Replace with a partial unique per source.

alter table public.prospects
  alter column seller_id drop not null;

-- Source discriminator so the two paths are distinguishable in queries
-- (reporting, filtering, safety-gate stats). Audience rows carry a
-- back-pointer to the engager they came from so we can trace attribution
-- back through the funnel.
alter table public.prospects
  add column if not exists source text not null default 'seller_import'
    check (source in ('seller_import','audience_engager','manual')),
  add column if not exists engager_id uuid
    references public.competitor_engagers(id) on delete set null;

create index if not exists prospects_source_idx
  on public.prospects (account_id, source, created_at desc);

-- Keep the old (seller_id, provider_id) unique for CSV imports so a
-- re-import doesn't duplicate. Add a separate partial unique for
-- audience rows keyed on (account_id, provider_id) where seller_id IS NULL.
create unique index if not exists prospects_audience_unique_idx
  on public.prospects (account_id, provider_id)
  where seller_id is null and provider_id is not null;

-- ---------------------------------------------------------------------------
-- target_segments — templates + fail-closed controls
-- ---------------------------------------------------------------------------
-- daily_send_cap capped at 20 by the check constraint — the hard ceiling
-- I want to enforce at the schema layer so a misconfigured UI or task
-- can't push past LinkedIn's soft weekly-outbound tolerance.
--
-- auto_send defaults to false: the segment is dormant until you flip it
-- on in the UI. Same fail-closed pattern the Apollo + Pakistan flows use.

alter table public.target_segments
  add column if not exists invite_template text,
  add column if not exists dm_template text,
  add column if not exists dm_followup_template text,
  add column if not exists daily_send_cap int not null default 10
    check (daily_send_cap between 1 and 20),
  add column if not exists auto_send boolean not null default false,
  add column if not exists paused_at timestamptz,
  add column if not exists pause_reason text;

-- Partial index so the "which segments should we source today" query in
-- the daily task is cheap even as archived + paused segments accumulate.
create index if not exists target_segments_active_send_idx
  on public.target_segments (account_id)
  where auto_send = true and archived_at is null and paused_at is null;

commit;

notify pgrst, 'reload schema';
