-- 003_competitor_media_comments.sql
-- Stage 3 — adds the columns the deep competitor analyzer needs:
--   media_urls         array of {url, type, thumbnail_url} extracted from raw
--   media_type         primary media kind for filtering
--   impressions        when Unipile returns impressions_counter
--   comments_data      lazy-populated full comment threads (JSONB)
--   comments_fetched_at controls 6h staleness so we don't re-charge Unipile
--
-- JSONB for comments instead of a separate table — comments are read with
-- their post, never queried independently, and a 50-comment cap keeps
-- row size bounded (~25KB max).
--
-- Apply in Supabase SQL Editor:  https://supabase.com/dashboard/project/zcnyyvzqakygpzgctzjo/sql

alter table public.competitor_posts
  add column if not exists media_urls jsonb,
  add column if not exists media_type text
    check (media_type in ('image','video','document','article','gif','none')),
  add column if not exists impressions int,
  add column if not exists comments_data jsonb,
  add column if not exists comments_fetched_at timestamptz;

create index if not exists competitor_posts_media_type_idx
  on public.competitor_posts (competitor_id, media_type);
create index if not exists competitor_posts_posted_at_idx
  on public.competitor_posts (competitor_id, posted_at desc);

notify pgrst, 'reload schema';
