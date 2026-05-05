# LinkedIn Agent

Performance-driven LinkedIn growth system for Lynx Media. Built on the **WAT framework** (Workflows · Agents · Tools) with Trigger.dev for scheduled / delayed background jobs and a Next.js webapp for human review.

## Architecture

Three layers, one repo:

- **Python tools** ([tools/](./tools/)) — deterministic execution. Reads/writes the canonical store (Supabase Postgres), generates content, renders visual assets, drafts engagement replies. See [CLAUDE.md](./CLAUDE.md) and [workflows/](./workflows/) for the full SOPs.
- **Trigger.dev tasks** ([trigger/](./trigger/)) — scheduled / delayed work. Runs the engagement-loop sequencer (T+0 reply, T+3h DM, follow-up reply), weekly retros, and any cron jobs that don't fit a request/response shape.
- **Webapp** ([webapp/](./webapp/)) — Next.js 15 + Tailwind + shadcn-style components + Supabase. Human review surface: kanban pipeline, angle detail view, recipient log, calendar. Replaces the Google Sheet UI. Hosted on Vercel.

```
Linkedin-agent/
├── CLAUDE.md                # Project instructions for Claude Code
├── db/                      # Supabase schema (canonical state store)
│   ├── schema.sql           # apply once on a fresh Supabase project
│   └── migrations/
├── workflows/               # Markdown SOPs (the "what" and "in what order")
├── tools/                   # Python tools (deterministic execution)
│   ├── requirements.txt
│   ├── supabase_client.py   # canonical client (reads SUPABASE_URL/KEY from .env)
│   └── sheets_client.py     # legacy gspread client — only used by drive_upload + the one-shot Sheet→Supabase migration
├── references/              # Brand reference, locked decisions
├── .claude/skills/          # Custom Claude Code skills (carousel, image, lead-magnet)
├── trigger/                 # Trigger.dev jobs (TypeScript)
│   └── lib/supabase.ts      # service-role-keyed client for cloud worker writes
├── webapp/                  # Next.js webapp (kanban + detail + recipients + calendar)
├── package.json             # Node deps + Trigger.dev SDK + @supabase/supabase-js
├── trigger.config.ts        # Trigger.dev project config
└── temp/                    # Working files (gitignored except resources/)
    ├── outputs/             # Regenerable: drafts, rendered images, PDFs
    └── resources/           # Reference materials + fonts (committed)
```

## Setup

### 0. Supabase project

1. Create a project at https://supabase.com (free tier is fine).
2. SQL editor → paste [db/schema.sql](./db/schema.sql) → Run. This creates the `angles`, `lead_magnet_recipients`, `audit_log`, `patterns`, `killed_topics`, and `metrics` tables with indexes + RLS.
3. Settings → API → grab the project URL, the **anon key** (public), and the **service-role key** (server-only).

### 1. Python side

```bash
python3 -m pip install --user -r tools/requirements.txt
```

Required env vars in `.env` (see [.env.example](./.env.example)):
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — canonical state store
- `OPENROUTER_API_KEY` — image gen via openai/gpt-5-image-mini
- `OPENROUTER_IMAGE_MODEL=openai/gpt-5-image-mini`
- `UNIPILE_API_KEY` + `UNIPILE_DSN` + `UNIPILE_LINKEDIN_ACCOUNT_ID` — LinkedIn read/write
- `TRIGGER_SECRET_KEY` — fires the engagement-loop task from Python

Legacy (only needed for [tools/drive_upload_lead_magnet.py](./tools/drive_upload_lead_magnet.py) Drive uploads + the one-shot Sheet→Supabase migration):
- `GOOGLE_OAUTH_CLIENT_PATH` + `GOOGLE_OAUTH_TOKEN_PATH`
- `LYNX_GROWTH_PLAN_SHEET_ID` (only for migration)

### 2. Migrate existing Sheet data (one-time)

If you're coming from the Sheet-based version of this project:
```bash
python3 tools/migrate_sheet_to_supabase.py --dry-run   # preview
python3 tools/migrate_sheet_to_supabase.py             # actually migrate
```
Idempotent — safe to re-run. After this, the Sheet stays as a frozen backup.

### 3. Trigger.dev side

```bash
npm install
npx trigger.dev@latest login
npx trigger.dev@latest dev      # local dev (leave running)
npx trigger.dev@latest deploy   # deploy to your Trigger.dev project
```

You'll need a Trigger.dev account (https://trigger.dev) and a project ID — paste it into [trigger.config.ts](./trigger.config.ts).

#### Trigger.dev project Environment Variables

The Trigger.dev cloud worker needs its own copy of these (set them at cloud.trigger.dev → your project → Environment Variables, NOT in your local `.env`):

| Var | Value | Used by |
|---|---|---|
| `UNIPILE_API_KEY` | same as local | engagement-loop comment + DM dispatch |
| `UNIPILE_DSN` | same as local | engagement-loop base URL |
| `UNIPILE_LINKEDIN_ACCOUNT_ID` | same as local | sender identity |
| `SUPABASE_URL` | same as local | recipient-row patches + audit_log |
| `SUPABASE_SERVICE_ROLE_KEY` | same as local | bypasses RLS for server-side writes |

No Google service account is needed — service-role-keyed Supabase replaces the JWT/Sheets-API dance entirely.

### 4. Webapp side

```bash
cd webapp
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY (server-only), ALLOWED_EMAILS

npm install
npm run dev
# open http://localhost:3000
```

Sign in with the email in `ALLOWED_EMAILS` and click the magic link. See [webapp/README.md](./webapp/README.md) for routes + Vercel deployment.

## How it runs

1. Run the WAT pipeline locally to draft + render posts: see [workflows/00_overview.md](./workflows/00_overview.md). Drafts are written to Supabase, not files.
2. After publishing a post via [workflows/07_publish.md](./workflows/07_publish.md), the Trigger.dev job in [trigger/engagement_loop.ts](./trigger/engagement_loop.ts) takes over: monitors comments, schedules the T+3h DM with the lead-magnet asset, posts the follow-up comment, patches the recipient row.
3. Weekly retro pulls metrics back into Supabase for [workflows/09_performance_review.md](./workflows/09_performance_review.md).
4. The webapp is the human review surface — approve drafts on phone, watch the recipient log in real time, etc.

## Don't commit

`.env`, any `credentials.json` / `token.json` / service-account JSON, `webapp/.env.local`. The `.gitignore` covers them, but double-check before every push.
