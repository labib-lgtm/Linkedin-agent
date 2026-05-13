-- Migration 020: Prospect enrichment — Amazon seller CSV → LinkedIn contacts
--
-- New tables:
--   seller_imports — one row per CSV upload (status, progress)
--   sellers        — raw Amazon seller data + LinkedIn company match outcome
--   prospects      — LinkedIn people matched to a seller (0-5 per seller without Sales Nav)
--
-- Flow:
--   POST /api/prospects/imports (CSV) → seller_imports row + sellers rows
--   → Trigger.dev `enrich-seller-imports` task runs, calls Unipile per seller
--   → prospects rows get populated
--   → operator reviews at /prospects, manually triggers outreach via existing flows
--
-- Requires migrations 011–019 applied first.

begin;

create table if not exists public.seller_imports (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  filename text not null,
  row_count int not null,
  enriched_count int not null default 0,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed','cancelled')),
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.sellers (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.seller_imports(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  seller_name text,
  business_name text,
  category text,
  primary_subcategory text,
  est_monthly_revenue numeric,
  avg_price numeric,
  percent_fba numeric,
  num_asins int,
  num_brands int,
  growth_3mo numeric,
  city text,
  state text,
  country text,
  storefront_url text,
  -- enrichment outcome
  linkedin_company_urn text,
  linkedin_company_url text,
  enrichment_status text not null default 'pending'
    check (enrichment_status in ('pending','matched','no_match','failed')),
  enrichment_error text,
  enriched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text,
  headline text,
  linkedin_url text,
  provider_id text,
  status text not null default 'new'
    check (status in ('new','contacted','responded','converted','archived')),
  notes text,
  created_at timestamptz not null default now(),
  unique (seller_id, provider_id)
);

create index if not exists seller_imports_account_idx
  on public.seller_imports (account_id, created_at desc);

create index if not exists sellers_import_idx
  on public.sellers (import_id, enrichment_status);

create index if not exists prospects_account_status_idx
  on public.prospects (account_id, status, created_at desc);

commit;

notify pgrst, 'reload schema';
