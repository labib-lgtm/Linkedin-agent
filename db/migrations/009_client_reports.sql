-- Migration 009: Weekly client reports
--
-- Phase 5 of Compare v2. Trigger.dev task runs Mondays per account,
-- pulls top 3 changes (Phase 3 events), top 3 breakouts (Phase 1 author-
-- median analysis), and top 3 recommended hooks (Phase 4 hook_patterns).
-- Stored in client_reports with a 16-char share_token so a public
-- /reports/[token] page renders the report without PIN auth.
--
-- Requires migrations 005-008.

begin;

create table if not exists public.client_reports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  week_start date not null,
  share_token text not null unique default substr(md5(random()::text || clock_timestamp()::text), 1, 16),
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  unique (account_id, week_start)
);

create index if not exists client_reports_account_week_idx
  on public.client_reports (account_id, week_start desc);

commit;

notify pgrst, 'reload schema';
