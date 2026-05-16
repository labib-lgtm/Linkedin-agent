-- 021_seller_brand_name.sql
-- Adds brand_name to sellers — the brand display name scraped from the
-- Amazon storefront page. This is the canonical name we use to query
-- LinkedIn (instead of the often-generic seller_name/business_name from
-- the CSV, e.g. "Between LLC" → "BTween Girls Apparel"). Cached on the
-- row so we only scrape once per seller.

alter table public.sellers
  add column if not exists brand_name text;

comment on column public.sellers.brand_name is
  'Brand display name scraped from the Amazon storefront. Preferred over seller_name/business_name when searching LinkedIn for the company match.';
