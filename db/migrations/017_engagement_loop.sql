-- Migration 017: engagement loop — comment replies + outbound commenting
--
-- Phase G. Two new tables:
--   post_comment_replies — AI-drafted replies to comments on OUR posts.
--                          Operator approves → bot posts via Unipile.
--   outbound_comments    — AI-drafted comments on COMPETITOR posts.
--                          Operator approves → bot posts. Hard pace
--                          gate: max 5/day/account, 2h gap (per the
--                          roast — LinkedIn flags > 20 comments/day
--                          on new automation).
--
-- Requires migrations 011-016 applied first.

begin;

create table if not exists public.post_comment_replies (
  id uuid primary key default gen_random_uuid(),
  angle_id text not null references public.angles(angle_id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  comment_provider_id text not null,             -- Unipile comment id
  commenter_name text,
  comment_text text,
  reply_text text,
  status text not null default 'pending',        -- pending | sent | skipped | failed
  created_at timestamptz default now(),
  sent_at timestamptz,
  unique (angle_id, comment_provider_id)
);

create table if not exists public.outbound_comments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  competitor_post_id text not null,              -- references competitor_posts.post_id
  competitor_id uuid references public.competitors(id) on delete set null,
  draft_comment text,
  status text not null default 'draft',          -- draft | approved | sent | rejected
  generated_at timestamptz default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  unique (account_id, competitor_post_id)
);

create index if not exists post_comment_replies_status_idx on public.post_comment_replies (status, created_at);
create index if not exists outbound_comments_status_idx on public.outbound_comments (status, generated_at);

commit;

notify pgrst, 'reload schema';
