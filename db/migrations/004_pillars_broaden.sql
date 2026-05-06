-- Migration 004: Broaden pillar enum
--
-- Renames 'PPC Operator' -> 'Performance Operator' (covers PPC + listings +
-- DSP + ranking + conversion) and adds 'Channel Strategy' (TikTok,
-- off-Amazon, launch tactics). Existing rows on 'PPC Operator' remap
-- before the new check is added so no row violates the constraint.
--
-- The pillar CHECK constraint name is the Postgres default
-- (table_column_check). Confirm in your project before running:
--
--   select conname from pg_constraint
--   where conrelid = 'public.angles'::regclass and conname like '%pillar%';
--
-- If the actual name differs, edit the DROP CONSTRAINT line below to
-- match. The IF EXISTS guard makes the wrong name a no-op rather than
-- an error, but the new constraint won't apply if the old one is still
-- attached -- so verify.

begin;

alter table public.angles drop constraint if exists angles_pillar_check;

update public.angles
   set pillar = 'Performance Operator'
 where pillar = 'PPC Operator';

alter table public.angles
  add constraint angles_pillar_check
  check (
    pillar is null or pillar in (
      'Performance Operator',
      'Conversion Lab',
      'Agency Founder',
      'Channel Strategy'
    )
  );

commit;

-- Tell PostgREST to refresh its schema cache so the new constraint is
-- visible to API clients without a Supabase project restart.
notify pgrst, 'reload schema';
