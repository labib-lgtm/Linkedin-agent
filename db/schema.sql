-- LinkedIn Agent — canonical Postgres schema (Supabase-compatible)
-- Replaces Google Sheets canonical store. Mirrors tools/sheets_client.py SCHEMA.
--
-- For a fresh Supabase project, paste this entire file into the SQL editor and
-- run it. db/migrations/001_initial.sql holds an identical copy for psql apply.

create extension if not exists "uuid-ossp";

-- ============================================================================
-- angles: every post idea, from generation through review.
-- One row per post. Status drives the kanban in the webapp.
-- ============================================================================
create table if not exists public.angles (
    angle_id          text primary key,        -- e.g. "2026-W18-A08"
    status            text not null default 'Pending'
                          check (status in (
                              'Pending', 'Approved', 'Killed', 'Drafting',
                              'Drafted', 'Visualizing', 'Visual Ready',
                              'Scheduled', 'Posted', 'Reviewed'
                          )),
    pillar            text check (pillar is null or pillar in (
                              'Performance Operator', 'Conversion Lab',
                              'Agency Founder', 'Channel Strategy'
                          )),
    format            text check (format is null or format in (
                              'text', 'carousel', 'image', 'video', 'poll'
                          )),

    -- Generation metadata
    hook_seed         text,
    cta_keyword       text,
    winner_patterns   text,
    gap_filled        text,

    -- User-controlled
    week_assigned     text,
    notes             text,

    -- Timestamps + URL
    date_generated    timestamptz,
    date_approved     timestamptz,
    date_posted       timestamptz,
    post_url          text,

    -- Draft (canonical body lives here, not on disk)
    hook_chosen       text,
    hook_alternates   text,
    draft_body        text,
    critic_score      text,
    slide_outline     text,

    -- Audit
    source_md         text,

    -- Visual asset (path to PNG / PDF rendered for this angle)
    asset_path        text,
    image_size        text,

    -- Lead magnet
    lead_magnet_path  text,
    lead_magnet_url   text,

    -- Bookkeeping
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists idx_angles_status         on public.angles (status);
create index if not exists idx_angles_date_posted    on public.angles (date_posted);
create index if not exists idx_angles_week_assigned  on public.angles (week_assigned);

-- updated_at autotrigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_angles_updated_at on public.angles;
create trigger trg_angles_updated_at
    before update on public.angles
    for each row execute function public.set_updated_at();

-- ============================================================================
-- patterns: hook patterns we've validated in the wild
-- ============================================================================
create table if not exists public.patterns (
    pattern_id        text primary key,
    name              text not null,
    description       text,
    example_post_url  text,
    active            boolean not null default true,
    created_at        timestamptz not null default now()
);

-- ============================================================================
-- killed_topics: angles we explicitly chose not to pursue (for de-dup later)
-- ============================================================================
create table if not exists public.killed_topics (
    killed_id          text primary key,
    topic_summary      text not null,
    reason             text,
    date_killed        timestamptz not null default now(),
    source_angle_id    text references public.angles(angle_id) on delete set null
);

-- ============================================================================
-- metrics: post-publish performance pulled back from LinkedIn
-- One row per pulled_at snapshot per angle (so we can track trajectory).
-- ============================================================================
create table if not exists public.metrics (
    angle_id          text not null references public.angles(angle_id) on delete cascade,
    post_url          text,
    impressions       integer,
    reactions         integer,
    comments          integer,
    reposts           integer,
    saves             integer,
    sends             integer,
    dwell_ratio       numeric,
    verdict           text,
    pulled_at         timestamptz not null default now(),
    primary key (angle_id, pulled_at)
);

create index if not exists idx_metrics_pulled_at on public.metrics (pulled_at desc);

-- ============================================================================
-- lead_magnet_recipients: engagement-loop recipient log.
-- One row per CTA-keyword commenter. Written queued by
-- tools/unipile_monitor_comments.py, patched to completed by
-- trigger/engagement_loop.ts at T+3h.
-- ============================================================================
create table if not exists public.lead_magnet_recipients (
    recipient_id      uuid primary key default uuid_generate_v4(),
    angle_id          text references public.angles(angle_id) on delete cascade,
    post_url          text,
    comment_id        text,
    commenter_id      text,
    commenter_name    text,
    cta_keyword       text,
    trigger_run_id    text,
    queued_at         timestamptz not null default now(),
    t0_reply_at       timestamptz,
    dm_sent_at        timestamptz,
    t3_reply_at       timestamptz,
    status            text not null default 'queued'
                          check (status in (
                              'queued', 'replied', 'dm_sent', 'completed', 'failed'
                          ))
);

create index if not exists idx_recipients_angle_id on public.lead_magnet_recipients (angle_id);
create index if not exists idx_recipients_status   on public.lead_magnet_recipients (status);
create unique index if not exists uniq_recipients_comment
    on public.lead_magnet_recipients (comment_id) where comment_id is not null;

-- ============================================================================
-- audit_log: append-only event stream.
-- Replaces the temp/outputs/published/YYYY-WW.md dump files.
-- ============================================================================
create table if not exists public.audit_log (
    event_id          uuid primary key default uuid_generate_v4(),
    angle_id          text references public.angles(angle_id) on delete cascade,
    event_type        text not null,        -- post_published, lead_magnet_dispatched, ...
    payload           jsonb,
    created_at        timestamptz not null default now()
);

create index if not exists idx_audit_angle_id    on public.audit_log (angle_id);
create index if not exists idx_audit_event_type  on public.audit_log (event_type);
create index if not exists idx_audit_created_at  on public.audit_log (created_at desc);

-- ============================================================================
-- Row-level security.
-- Service role (used by Python tools + Trigger.dev) bypasses RLS automatically.
-- Authenticated users (Supabase Auth in the webapp) get full access for now.
-- Tighten when adding read-only roles or multi-tenant.
-- ============================================================================
alter table public.angles                  enable row level security;
alter table public.patterns                enable row level security;
alter table public.killed_topics           enable row level security;
alter table public.metrics                 enable row level security;
alter table public.lead_magnet_recipients  enable row level security;
alter table public.audit_log               enable row level security;

drop policy if exists "authenticated_full_access" on public.angles;
create policy "authenticated_full_access" on public.angles
    for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.patterns;
create policy "authenticated_full_access" on public.patterns
    for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.killed_topics;
create policy "authenticated_full_access" on public.killed_topics
    for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.metrics;
create policy "authenticated_full_access" on public.metrics
    for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.lead_magnet_recipients;
create policy "authenticated_full_access" on public.lead_magnet_recipients
    for all to authenticated using (true) with check (true);

drop policy if exists "authenticated_full_access" on public.audit_log;
create policy "authenticated_full_access" on public.audit_log
    for all to authenticated using (true) with check (true);
