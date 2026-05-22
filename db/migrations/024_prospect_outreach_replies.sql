-- 024_prospect_outreach_replies.sql
-- Phase 3 of prospect warm-outreach: reply detection + a follow-up bump.
--
-- After a DM is sent we poll the chat for the prospect's reply; on a reply
-- the sequence moves to a new 'responded' stage (human takes over) and the
-- prospect's status flips to 'responded'. If no reply after a delay, one
-- gentle follow-up DM is sent automatically.

-- Add 'responded' to the stage enum.
alter table public.prospect_outreach drop constraint if exists prospect_outreach_stage_check;
alter table public.prospect_outreach add constraint prospect_outreach_stage_check
  check (stage in ('engaging','ready_to_invite','invited','connected','dm_sent','responded','done'));

alter table public.prospect_outreach
  add column if not exists dm_chat_id text,
  add column if not exists replied_at timestamptz,
  add column if not exists reply_snippet text,
  add column if not exists followups_sent int not null default 0,
  add column if not exists last_followup_at timestamptz;

comment on column public.prospect_outreach.dm_chat_id is
  'Unipile chat id from the first DM; polled to detect the prospect''s reply.';
comment on column public.prospect_outreach.reply_snippet is
  'First line of the prospect''s reply, surfaced in the Sequence tab for handoff.';
