-- 001_initial.sql — first migration. Identical content to db/schema.sql.
-- Apply once on a fresh Supabase project (paste into SQL editor or run via psql).
-- After this, future migrations live as 002_*.sql, 003_*.sql, ... and are
-- additive (add columns, change check constraints, new tables). Never edit
-- this file after it's been applied to a live project — write a new migration.

create extension if not exists "uuid-ossp";

-- ============================================================================
-- angles
-- ============================================================================
create table if not exists public.angles (
    angle_id          text primary key,
    status            text not null default 'Pending'
                          check (status in (
                              'Pending', 'Approved', 'Killed', 'Drafting',
                              'Drafted', 'Visualizing', 'Visual Ready',
                              'Scheduled', 'Posted', 'Reviewed'
                          )),
    pillar            text check (pillar is null or pillar in (
                              'PPC Operator', 'Conversion Lab', 'Agency Founder'
                          )),
    format            text check (format is null or format in (
                              'text', 'carousel', 'image', 'video', 'poll'
                          )),

    hook_seed         text,
    cta_keyword       text,
    winner_patterns   text,
    gap_filled        text,

    week_assigned     text,
    notes             text,

    date_generated    timestamptz,
    date_approved     timestamptz,
    date_posted       timestamptz,
    post_url          text,

    hook_chosen       text,
    hook_alternates   text,
    draft_body        text,
    critic_score      text,
    slide_outline     text,

    source_md         text,

    asset_path        text,
    image_size        text,

    lead_magnet_path  text,
    lead_magnet_url   text,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists idx_angles_status         on public.angles (status);
create index if not exists idx_angles_date_posted    on public.angles (date_posted);
create index if not exists idx_angles_week_assigned  on public.angles (week_assigned);

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
-- patterns
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
-- killed_topics
-- ============================================================================
create table if not exists public.killed_topics (
    killed_id          text primary key,
    topic_summary      text not null,
    reason             text,
    date_killed        timestamptz not null default now(),
    source_angle_id    text references public.angles(angle_id) on delete set null
);

-- ============================================================================
-- metrics
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
-- lead_magnet_recipients
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
-- audit_log
-- ============================================================================
create table if not exists public.audit_log (
    event_id          uuid primary key default uuid_generate_v4(),
    angle_id          text references public.angles(angle_id) on delete cascade,
    event_type        text not null,
    payload           jsonb,
    created_at        timestamptz not null default now()
);

create index if not exists idx_audit_angle_id    on public.audit_log (angle_id);
create index if not exists idx_audit_event_type  on public.audit_log (event_type);
create index if not exists idx_audit_created_at  on public.audit_log (created_at desc);

-- ============================================================================
-- RLS
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
