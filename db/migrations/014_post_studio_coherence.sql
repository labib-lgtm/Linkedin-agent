-- Migration 014: Post Studio — coherence quality check
--
-- Phase D of Pipeline v3. Replaces the original spec's 5-axis LLM
-- rubber-stamp with a deterministic check (per the project's roast):
-- word/char count, hook→body delivery via regex matching, brand color
-- distance for picked images, CTA archetype matches funnel destination.
-- Plus ONE binary LLM call ("would you publish this?") — no rubric
-- score theatre, just a yes/no with a one-line reason.
--
-- coherence_scores JSONB shape:
-- {
--   "word_count": 218,
--   "char_count": 1184,
--   "hook_delivery": { "ok": true, "reason": "promised 5 items, body lists 5" },
--   "brand_match":   { "ok": true, "average_score": 78 },
--   "cta_match":     { "ok": true, "archetype": "click", "has_link": true },
--   "voice_grounded": { "ok": true, "samples_used": 5 },
--   "publishable":   { "ok": true, "model": "anthropic/claude-haiku-4-5", "reason": "Specific enough, on-brand, ready" },
--   "average":       0.92
-- }
--
-- Requires migrations 011-013 applied first.

begin;

alter table public.angles
  add column if not exists coherence_scores jsonb,
  add column if not exists coherence_checked_at timestamptz;

commit;

notify pgrst, 'reload schema';
