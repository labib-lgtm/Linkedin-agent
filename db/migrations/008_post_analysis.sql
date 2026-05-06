-- Migration 008: LLM hook patterns + theme clustering
--
-- Phase 4 of Compare v2. Daily Trigger.dev worker extracts hook
-- templates from each post (LLM), embeds the post text (OpenRouter
-- embedding), and clusters posts into themes by cosine similarity.
-- Powers the Hook Patterns + Themes panels and replaces the templated
-- prefix-grouping in InsightBanner card #1.
--
-- Requires migrations 005 + 006 + 007 applied.

begin;

-- ---------------------------------------------------------------------------
-- themes — Phase 4. One row per discovered cluster, scoped per account.
-- ---------------------------------------------------------------------------
create table if not exists public.themes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,                 -- LLM-generated short name
  llm_summary text,                   -- One-sentence description
  post_count int default 0,
  avg_score numeric default 0,
  leader_competitor_id uuid references public.competitors(id) on delete set null,
  centroid jsonb,                     -- Mean embedding (1536-dim float array)
  last_clustered_at timestamptz default now()
);

create index if not exists themes_account_idx on public.themes (account_id, post_count desc);

-- ---------------------------------------------------------------------------
-- hook_patterns — extracted LLM hook templates per account.
-- ---------------------------------------------------------------------------
create table if not exists public.hook_patterns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  template text not null,             -- e.g. "I spent X hours / N days collecting…"
  normalized_key text not null,       -- For grouping (lowercased, no params)
  sample_count int default 0,
  avg_score numeric default 0,
  last_clustered_at timestamptz default now(),
  unique (account_id, normalized_key)
);

create index if not exists hook_patterns_account_idx
  on public.hook_patterns (account_id, avg_score desc);

-- ---------------------------------------------------------------------------
-- competitor_post_analysis — per-post analysis output. Joins back to
-- competitor_posts via the (competitor_id, post_id) composite which is
-- already unique on that table.
-- ---------------------------------------------------------------------------
create table if not exists public.competitor_post_analysis (
  post_id text not null,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  hook_template text,                 -- Display: "I spent X hours doing Y"
  hook_normalized text,               -- Group key
  word_count int,
  embedding jsonb,                    -- 1536-dim float array
  theme_id uuid references public.themes(id) on delete set null,
  analyzed_at timestamptz default now(),
  primary key (competitor_id, post_id)
);

create index if not exists post_analysis_account_idx
  on public.competitor_post_analysis (account_id, analyzed_at desc);

create index if not exists post_analysis_theme_idx
  on public.competitor_post_analysis (theme_id);

commit;

notify pgrst, 'reload schema';
