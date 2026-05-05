# Lynx LinkedIn Agent — Webapp

Next.js 15 + Tailwind + Supabase. Replaces Google Sheets as the human review surface for the LinkedIn agent pipeline.

## Quick start

```bash
cd webapp
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY (server-only), ALLOWED_EMAILS

npm install
npm run dev
# open http://localhost:3000
```

You'll be redirected to `/login`. Enter the email in `ALLOWED_EMAILS` and click the magic link in your inbox.

## Routes

- `/` — pipeline kanban grouped by status
- `/angles/[id]` — angle detail with status transitions, draft body, asset/lead-magnet links, recipient log
- `/angles/new` — create angle form
- `/recipients` — engagement-loop recipient log
- `/calendar` — angles grouped by `week_assigned`

## Auth

Magic-link via Supabase Auth. The callback at `/auth/callback/route.ts` enforces an email allowlist from `ALLOWED_EMAILS` (comma-separated). Anyone outside the list is signed out immediately.

## Stack

- Next.js 15 App Router (server components by default)
- Tailwind + hand-written shadcn-style components in `components/ui/`
- `@supabase/ssr` for cookie-based session handling across server + client
- `@supabase/supabase-js` underneath

## Vercel deployment (post-build)

Standard Next.js — Vercel is the natural target.

1. Push the repo to GitHub (already at github.com/labib-lgtm/Linkedin-agent)
2. https://vercel.com → **Add New** → **Project** → import the GitHub repo
3. **Root Directory**: `webapp` (critical — without this, Vercel tries to build the repo root which has the Trigger.dev code)
4. Add the four env vars in Vercel project settings: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_EMAILS`
5. **Deploy**. Subsequent pushes to `main` auto-deploy.
6. After first deploy, Supabase dashboard → Authentication → URL Configuration → add `https://<your-vercel-url>/auth/callback` to **Redirect URLs** and the Vercel URL to **Site URL**. Without this, magic-link sign-in fails in production.

