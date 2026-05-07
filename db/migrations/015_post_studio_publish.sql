-- Migration 015: Post Studio — carousel PDF + LinkedIn publish
--
-- Phase E. Closes the loop from "studio composes a carousel" to "post
-- is live on LinkedIn." Renders the slide spec to a multi-page PDF
-- (one 1080x1080 page per slide) via @react-pdf/renderer in a
-- Trigger.dev task, uploads to Storage, then attaches via Unipile's
-- media endpoint.
--
-- Requires migrations 011-014 applied first.

begin;

alter table public.angles
  add column if not exists carousel_pdf_path text,         -- Storage path in 'post-assets' bucket
  add column if not exists carousel_rendered_at timestamptz,
  add column if not exists publish_run_id text,            -- Trigger.dev run id for status polling
  add column if not exists published_media_urn text;       -- Unipile / LinkedIn media URN once attached

commit;

notify pgrst, 'reload schema';
