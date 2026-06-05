-- 027 — flag prospects who skipped the warm-up because they went inactive.
--
-- The comment warm-up needs the prospect to actually be posting on LinkedIn.
-- If a prospect hasn't posted in 30 days, no comment can land, and they sit
-- in the `engaging` stage forever. This column marks prospects who were
-- auto-promoted from `engaging` to `ready_to_invite` by the inactive-handler
-- (not by reaching the comments_target), so the UI can surface them with a
-- "cold" badge and so the connection-note drafter can adapt the tone if/when
-- we wire that up later.
--
-- Promotion logic lives in trigger/prospect_engagement.ts (track cron):
--   if stage='engaging' AND paused=false AND enrolled_at <= now()-7d
--      AND (no posts in last 30d) AND cold_invite=false
--   → set stage='ready_to_invite', cold_invite=true
--
-- The standard ready_to_invite UX still applies — operator approves each
-- connection note before the send-prospect-invites worker fires it.

alter table public.prospect_outreach
  add column if not exists cold_invite boolean not null default false;

create index if not exists prospect_outreach_cold_invite_idx
  on public.prospect_outreach (cold_invite)
  where cold_invite = true;
