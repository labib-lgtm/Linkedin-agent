-- Migration 012: Post Studio — carousel slide structure
--
-- Phase B of Pipeline v3 / Post Studio. Generates a structured slide
-- spec (cover / list / payoff / CTA) per the post body and renders the
-- right pane of the studio. Phase C will populate `image_gen_prompt`
-- per slide; Phase B ships text-only slides with brand-themed CSS.
--
-- Requires migration 011 applied first.

begin;

alter table public.angles
  add column if not exists carousel_template text,         -- story|list|compare|framework
  add column if not exists carousel_slides jsonb,          -- full slide spec (see prompt #2 schema)
  add column if not exists slides_generated_at timestamptz;

-- Per-account brand visual tokens. brand_color stays as the primary
-- token (already exists from migration 006); brand_palette gives the
-- richer 5-color set the slides need.
alter table public.accounts
  add column if not exists brand_palette jsonb,            -- { primary, secondary, accent, ink, paper }
  add column if not exists brand_typography text;          -- short string e.g. "Georgia headlines, Inter UI"

commit;

notify pgrst, 'reload schema';
