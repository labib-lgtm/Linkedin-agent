-- Migration 011: Post Studio — copy generation
--
-- Phase A of Pipeline v3 / Post Studio. Adds the structured-copy columns
-- the editor reads + writes. draft_body stays for backwards compatibility
-- with the existing publish path; the studio keeps it in sync by joining
-- body_paragraphs on save.
--
-- Requires migrations 005-010 applied first.

begin;

alter table public.angles
  add column if not exists hook_variants jsonb,            -- [{ text, voice_match_score, predicted_engagement_pct }]
  add column if not exists selected_hook_index int,        -- 0..N pointer into hook_variants
  add column if not exists body_paragraphs jsonb,          -- [{ role: hook|setup|pivot|list|payoff|cta, text }]
  add column if not exists cta_archetype text,             -- follow|comment|dm|click|demo
  add column if not exists cta_text text,
  add column if not exists pin_comment text,
  add column if not exists copy_generated_at timestamptz;

-- Cold-start helper. Auto-pulled voice samples (last 5 posted angles)
-- only work after the system has its own posting history; for fresh
-- accounts the operator pastes 3-5 representative posts here so the
-- voice prompt has real text to ground on. Plain text, one post per
-- blank-line-separated block.
alter table public.accounts
  add column if not exists seed_voice_samples text;

commit;

notify pgrst, 'reload schema';
