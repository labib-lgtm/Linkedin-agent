-- 023_prospect_outreach_approval.sql
-- Phase 2 of prospect warm-outreach: hybrid approval for connection
-- requests + DMs. Comments auto-send (Phase 1); invites and DMs are
-- drafted, then the operator approves before the paced sender fires.
--
-- Adds two approval flags to prospect_outreach. invite_message / dm_text
-- (the draft bodies) already exist from migration 022.

alter table public.prospect_outreach
  add column if not exists invite_approved boolean not null default false,
  add column if not exists dm_approved boolean not null default false;

comment on column public.prospect_outreach.invite_approved is
  'Operator approved the drafted connection note; the send-prospect-invites task picks these up.';
comment on column public.prospect_outreach.dm_approved is
  'Operator approved the drafted DM; the send-prospect-dms task picks these up.';
