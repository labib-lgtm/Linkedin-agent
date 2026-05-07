-- Migration 016: Post Studio — DM auto-reply template
--
-- Phase F. The lead-magnet plumbing already exists (cta_keyword,
-- lead_magnet_recipients table, Trigger.dev cta-comment-response task,
-- Unipile DM integration). What was missing: a single place to author
-- the DM template the auto-responder sends. This adds it to the angle
-- row + surfaces a textarea inline in the studio when CTA archetype is
-- 'dm'.
--
-- Requires migrations 011-015 applied first.

begin;

alter table public.angles
  add column if not exists dm_response_template text,      -- Sent to commenters who post the cta_keyword
  add column if not exists dm_response_includes_link boolean default true,
  add column if not exists dm_template_generated_at timestamptz;

commit;

notify pgrst, 'reload schema';
