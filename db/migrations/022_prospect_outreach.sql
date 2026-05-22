-- 022_prospect_outreach.sql
-- Warm-outreach sequence for prospects: track posts → auto-comment →
-- (Phase 2) connect → DM. Two tables:
--   prospect_outreach — one row per enrolled prospect; the "list" + state.
--   prospect_posts    — a prospect's tracked LinkedIn posts (mirrors
--                       competitor_posts), with a flag for whether we've
--                       commented on each.

create table if not exists public.prospect_outreach (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  stage text not null default 'engaging'
    check (stage in ('engaging','ready_to_invite','invited','connected','dm_sent','done')),
  paused boolean not null default false,
  -- resolved LinkedIn member id (ACo…), cached on first track so we only
  -- resolve the prospect's identifier once.
  provider_id text,
  comments_made int not null default 0,
  comments_target int not null default 3,
  last_comment_at timestamptz,
  -- Phase 2 columns (defined now so no later migration is needed):
  invite_sent_at timestamptz,
  invite_message text,
  connected_at timestamptz,
  dm_sent_at timestamptz,
  dm_text text,
  enrolled_at timestamptz not null default now(),
  unique (prospect_id)
);

create index if not exists prospect_outreach_stage_idx
  on public.prospect_outreach (account_id, stage, paused);

create table if not exists public.prospect_posts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  post_id text not null,
  posted_at timestamptz,
  text text,
  reactions int not null default 0,
  comments int not null default 0,
  reposts int not null default 0,
  engagement_score numeric generated always as (reactions + comments * 3 + reposts * 5) stored,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  commented boolean not null default false,
  commented_at timestamptz,
  comment_text text,
  unique (prospect_id, post_id)
);

create index if not exists prospect_posts_uncommented_idx
  on public.prospect_posts (prospect_id, commented, posted_at desc);

create index if not exists prospect_posts_account_idx
  on public.prospect_posts (account_id, commented_at desc);

comment on table public.prospect_outreach is
  'Per-prospect warm-outreach sequence state: engaging → ready_to_invite → invited → connected → dm_sent → done.';
comment on table public.prospect_posts is
  'Tracked LinkedIn posts for enrolled prospects; commented flag drives the auto-comment task.';
