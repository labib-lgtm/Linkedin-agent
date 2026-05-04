# LinkedIn Agent

Performance-driven LinkedIn growth system for Lynx Media. Built on the **WAT framework** (Workflows · Agents · Tools) with Trigger.dev for scheduled / delayed background jobs.

## Architecture

Two halves, one repo:

- **Python (WAT framework)** — deterministic execution. Reads from a Google Sheet (the canonical store), generates content, renders visual assets, drafts engagement replies. See [CLAUDE.md](./CLAUDE.md) and [workflows/](./workflows/) for the full SOPs.
- **Trigger.dev (TypeScript)** — scheduled / delayed work. Runs the engagement-loop sequencer (T+0 reply, T+3h DM, follow-up reply), weekly retros, and any cron jobs that don't fit a request/response shape.

```
Linkedin-agent/
├── CLAUDE.md                # Project instructions for Claude Code
├── workflows/               # Markdown SOPs (the "what" and "in what order")
├── tools/                   # Python tools (deterministic execution)
│   └── requirements.txt
├── references/              # Brand reference, locked decisions
├── .claude/skills/          # Custom Claude Code skills (carousel, image, lead-magnet)
├── trigger/                 # Trigger.dev jobs (TypeScript)
├── package.json             # Node deps + Trigger.dev SDK
├── trigger.config.ts        # Trigger.dev project config
├── tsconfig.json
└── temp/                    # Working files (gitignored except resources/)
    ├── outputs/             # Regenerable: drafts, rendered images, PDFs
    └── resources/           # Reference materials + fonts (committed)
```

## Setup

### 1. Python side

```bash
python3 -m pip install --user -r tools/requirements.txt
```

Required env vars in `.env` (see `.env.example` if present, or `.env` in the prior project):
- `OPENROUTER_API_KEY` — image gen via openai/gpt-5-image-mini
- `OPENROUTER_IMAGE_MODEL=openai/gpt-5-image-mini`
- `UNIPILE_API_KEY` + `UNIPILE_DSN` + `UNIPILE_LINKEDIN_ACCOUNT_ID` — LinkedIn read/write
- `GOOGLE_OAUTH_CLIENT_PATH` + `GOOGLE_OAUTH_TOKEN_PATH` + `LYNX_GROWTH_PLAN_SHEET_ID`

### 2. Trigger.dev side

```bash
npm install
npx trigger.dev@latest login
npx trigger.dev@latest dev      # local dev
npx trigger.dev@latest deploy   # deploy to your Trigger.dev project
```

You'll need a Trigger.dev account (https://trigger.dev) and a project ID — paste it into `trigger.config.ts`.

## How it runs

1. Run the WAT pipeline locally to draft + render posts: see [workflows/00_overview.md](./workflows/00_overview.md).
2. After publishing a post via [workflows/07_publish.md](./workflows/07_publish.md), the Trigger.dev job in [trigger/engagement_loop.ts](./trigger/engagement_loop.ts) takes over: monitors comments, schedules the T+3h DM with the lead-magnet asset, posts the follow-up comment.
3. Weekly retro (`trigger/performance_review.ts`) pulls metrics back to the Sheet for [workflows/09_performance_review.md](./workflows/09_performance_review.md).

## Don't commit

`.env` and any `credentials.json` / `token.json`. The `.gitignore` covers them, but double-check before every push.
