-- Migration 013: Post Studio — image generation + brand-consistency
--
-- Phase C of Pipeline v3. Per-slide image variants from OpenAI gpt-image-1
-- with a deterministic brand-color check (sharp dominant-color extraction
-- vs. the account's brand_palette). post_assets keeps every variant
-- generated for an angle; slide_image_paths on angles caches the picked
-- per-slide path so the slide grid renders fast without joining.
--
-- Requires migrations 011 + 012 applied first.

begin;

alter table public.accounts
  add column if not exists brand_prompt_prefix text;       -- the [STYLE BLOCK] string fed into every image gen call

alter table public.angles
  add column if not exists slide_image_paths jsonb;        -- { "1": "path1.png", "7": "path7.png" } — picked variant per slide

create table if not exists public.post_assets (
  id uuid primary key default gen_random_uuid(),
  angle_id text not null references public.angles(angle_id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  slide_n int not null,
  variant_n int not null,                                  -- 0..3 (4 variants per gen call)
  storage_path text not null,                              -- in 'post-assets' bucket
  brand_score numeric,                                     -- 0..100 (deterministic dominant-color match)
  brand_score_detail jsonb,                                -- { dominant: { r, g, b }, closest_palette_key, distance }
  picked_at timestamptz,                                   -- non-null = user selected this variant
  generated_at timestamptz default now(),
  unique (angle_id, slide_n, variant_n, generated_at)
);

create index if not exists post_assets_angle_idx on public.post_assets (angle_id, slide_n);
create index if not exists post_assets_picked_idx on public.post_assets (angle_id) where picked_at is not null;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Storage bucket: create manually in Supabase Storage UI
--   bucket id:        post-assets
--   public:           true (read), service_role only for write
--   file size:        5 MB max
--   allowed mimes:    image/png, image/jpeg, image/webp
-- ---------------------------------------------------------------------------
