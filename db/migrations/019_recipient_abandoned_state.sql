-- Migration 019: lead_magnet_recipients — add 'abandoned' state + retry_count
--
-- Phase F engagement loop now supports a hold-and-retry pattern after the
-- T+3h DM step. If the angle's lead_magnet_url is empty when the DM is
-- about to fire, the task waits 1h and re-checks; up to 21 hourly retries
-- (T+3h .. T+24h). After that it gives up silently and marks the row
-- 'abandoned'.
--
-- We also formalize 'completed_partial' which engagement_loop.ts has been
-- writing (when the DM succeeds but the follow-up reply fails) without it
-- being in the check constraint.
--
-- A unique constraint on (angle_id, comment_id) prevents the new
-- monitor_post_comments cron from double-firing if two ticks see the same
-- comment before the first run's recipient row is committed.
--
-- Requires migrations 011-018 applied first.

begin;

alter table public.lead_magnet_recipients
  drop constraint if exists lead_magnet_recipients_status_check;

alter table public.lead_magnet_recipients
  add constraint lead_magnet_recipients_status_check
  check (status in (
    'queued',
    'replied',
    'dm_sent',
    'completed',
    'completed_partial',
    'failed',
    'abandoned'
  ));

alter table public.lead_magnet_recipients
  add column if not exists retry_count int not null default 0;

create unique index if not exists lead_magnet_recipients_angle_comment_idx
  on public.lead_magnet_recipients (angle_id, comment_id)
  where comment_id is not null;

commit;

notify pgrst, 'reload schema';
