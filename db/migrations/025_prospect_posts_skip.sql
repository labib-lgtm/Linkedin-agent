-- 025_prospect_posts_skip.sql
-- Tone-safety gate for the prospect auto-commenter. An LLM appropriateness
-- classifier now runs BEFORE drafting and SKIPS personal / sensitive / satirical
-- / non-English / off-topic posts. A skipped post is persisted so it is never
-- re-classified or commented on (excluded alongside commented=true).
alter table public.prospect_posts
  add column if not exists skipped     boolean not null default false,
  add column if not exists skip_reason text,
  add column if not exists skipped_at  timestamptz;
-- NOTE: comment_text already exists on prospect_posts (migration 022) — not re-added.

-- Per-prospect counter of skipped posts: surfaces "all their posts are
-- personal/satirical" prospects so they don't sit in engaging invisibly.
alter table public.prospect_outreach
  add column if not exists appropriate_skip_count integer not null default 0;

create index if not exists prospect_posts_actionable_idx
  on public.prospect_posts (engagement_score desc)
  where commented = false and skipped = false;

-- Rollback (manual, if ever needed):
-- drop index if exists prospect_posts_actionable_idx;
-- alter table public.prospect_posts
--   drop column if exists skipped, drop column if exists skip_reason, drop column if exists skipped_at;
-- alter table public.prospect_outreach drop column if exists appropriate_skip_count;
