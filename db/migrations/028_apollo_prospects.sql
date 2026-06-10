-- 028 — Apollo prospecting layer.
--
-- The user is uploading 6k more sellers on top of the current 999 and wants
-- to convert them into reachable prospects (email + phone) for Meta
-- retargeting and direct outreach. At ~7k scale we cannot afford to spend
-- an Apollo credit on every seller — most are shell LLCs, sole proprietors,
-- or defunct brands with no LinkedIn employees, and would yield nothing.
--
-- The worker (trigger/enrich_apollo.ts) runs a free pre-filter first via
-- Apollo's organizations/search endpoint. Only sellers confirmed to have
-- at least one LinkedIn employee get the paid people/match enrichment.
-- The outcome is cached on the seller row so future runs skip dead ends
-- in O(1) without re-spending search calls.

alter table public.sellers
  add column if not exists apollo_filter_status text
    check (apollo_filter_status in (
      'pending',
      'has_employees',
      'no_employees',
      'no_org_match',
      'enriched',
      'failed'
    )) default 'pending',
  add column if not exists apollo_employee_count int,
  add column if not exists apollo_filter_checked_at timestamptz;

create index if not exists sellers_apollo_filter_status_idx
  on public.sellers (apollo_filter_status);

-- The enriched-prospect record: one row per decision-maker. Joined back to
-- the originating seller for full Amazon + LinkedIn + person context.
create table if not exists public.apollo_prospects (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  apollo_person_id text,
  apollo_organization_id text,
  name text,
  first_name text,
  last_name text,
  title text,
  seniority text,
  email text,
  email_status text,
  phone text,
  linkedin_profile_url text,
  city text,
  state text,
  country text,
  -- Cached at write time so the UI table can render the Amazon + LinkedIn
  -- buttons without a second seller fetch per row.
  company_linkedin_url text,
  amazon_storefront_url text,
  raw jsonb,
  enriched_at timestamptz not null default now(),
  unique (seller_id, apollo_person_id)
);

create index if not exists apollo_prospects_seller_idx
  on public.apollo_prospects (seller_id);
create index if not exists apollo_prospects_account_idx
  on public.apollo_prospects (account_id);
create index if not exists apollo_prospects_email_idx
  on public.apollo_prospects (email)
  where email is not null;
