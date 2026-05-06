-- Migration 010: profile picture URL on snapshots
--
-- Phase 3.1 follow-up. The original Phase 3 captured cover image only;
-- the Compare strip + side-by-side modal still rendered initials for the
-- avatar because we never extracted the headshot URL from Unipile. This
-- adds a column the worker writes the LinkedIn CDN profile picture URL
-- to, plus the corresponding picture_url surface area on the worker.
--
-- We also surface cover_url on the API (already stored) so the UI can
-- fall back to LinkedIn's CDN when Storage upload fails.

begin;

alter table public.competitor_snapshots
  add column if not exists picture_url text;

commit;

notify pgrst, 'reload schema';
