-- 002_settings_competitors.sql
-- Adds the four tables needed by the webapp UX upgrade:
--   app_settings       — singleton row, JSONB bag of integration credentials + prefs
--   competitors        — tracked LinkedIn creators
--   competitor_posts   — cached posts per competitor with engagement_score
--   creator_digests    — weekly LLM-extracted patterns across competitors
--
-- Apply with:  psql "$SUPABASE_DB_URL" -f db/migrations/002_settings_competitors.sql
-- Or paste into Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- app_settings: single-row table; values is a JSONB bag.
-- Keys we use:
--   auth.pin_hash           bcrypt-style hash of the 4-digit PIN (or plain "3245" seed)
--   unipile.api_key         string
--   unipile.dsn             string
--   unipile.account_id      string
--   openrouter.api_key      string
--   openrouter.text_model   string  (default 'anthropic/claude-3.5-sonnet')
--   openrouter.image_model  string  (default 'openai/gpt-5-image-mini')
--   supabase.url            string  (display only — runtime reads env on cold start)
--   supabase.service_role_key string (display only)
--   google.client_id / google.client_secret  (placeholders for now)
-- ---------------------------------------------------------------------------
create table if not exists app_settings (
  id int primary key default 1,
  values jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into app_settings (id, values) values (1, '{}') on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- competitors: tracked LinkedIn creators we want to mine.
-- role distinguishes how the creator feeds the pipeline:
--   direct        head-to-head competitors (Amazon agencies, PPC operators)
--   format_source creators we mine for hook/format patterns regardless of niche
--   topic_source  niche experts we mine for topic ideas
-- ---------------------------------------------------------------------------
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  profile_url text not null,
  identifier text not null unique,
  display_name text,
  role text not null default 'direct'
       check (role in ('direct','format_source','topic_source')),
  active boolean not null default true,
  notes text,
  added_at timestamptz not null default now(),
  last_analyzed_at timestamptz
);

-- ---------------------------------------------------------------------------
-- competitor_posts: posts fetched from Unipile. engagement_score is a
-- generated column so the DB owns the formula:
--     reactions*1 + comments*3 + reposts*5
-- App code never writes engagement_score; it's recomputed on every change.
-- ---------------------------------------------------------------------------
create table if not exists competitor_posts (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  post_id text not null,
  posted_at timestamptz,
  text text,
  reactions int not null default 0,
  comments int not null default 0,
  reposts int not null default 0,
  engagement_score numeric generated always as (reactions + comments*3 + reposts*5) stored,
  raw jsonb,
  fetched_at timestamptz not null default now(),
  unique (competitor_id, post_id)
);
create index if not exists competitor_posts_score_idx
  on competitor_posts (competitor_id, engagement_score desc);

-- ---------------------------------------------------------------------------
-- creator_digests: one row per ISO week. top_posts is a JSONB array of the
-- N highest-scored posts across all active competitors that week;
-- pattern_summary is the LLM-extracted hook / format / topic summary.
-- ---------------------------------------------------------------------------
create table if not exists creator_digests (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  top_posts jsonb not null,
  pattern_summary jsonb,
  generated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS. Webapp talks to Supabase via the service-role client which bypasses
-- RLS, but we still enable it so anon clients (if anyone ever connects with
-- the public key) can't read these tables. app_settings in particular holds
-- secrets — keep it locked down.
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table competitors enable row level security;
alter table competitor_posts enable row level security;
alter table creator_digests enable row level security;

drop policy if exists "auth full access" on app_settings;
drop policy if exists "auth full access" on competitors;
drop policy if exists "auth full access" on competitor_posts;
drop policy if exists "auth full access" on creator_digests;

create policy "auth full access" on app_settings      for all to authenticated using (true) with check (true);
create policy "auth full access" on competitors       for all to authenticated using (true) with check (true);
create policy "auth full access" on competitor_posts  for all to authenticated using (true) with check (true);
create policy "auth full access" on creator_digests   for all to authenticated using (true) with check (true);
