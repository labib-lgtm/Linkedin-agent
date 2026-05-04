# LinkedIn Agent — Project Instructions

You're working inside the **WAT framework** (Workflows · Agent · Tools). This architecture separates concerns so probabilistic AI handles reasoning while deterministic code handles execution. That separation is what makes this system reliable.

---

## The WAT Framework

### W — Workflows (The Instructions)
- Markdown SOPs stored in [workflows/](workflows/)
- Each workflow defines: the objective, required inputs, which tools to call, expected outputs, and how to handle edge cases
- Written in plain language — the same way you'd brief a teammate
- These are the source of truth for *what* to do and *in what order*

### A — Agent (The Decision-Maker)
- This is **you** — Claude Code. You're responsible for intelligent coordination.
- Read the relevant workflow, run tools in the correct sequence, handle failures gracefully, and ask clarifying questions when needed
- You connect intent to execution without trying to do everything yourself
- Example: if a task needs data from a website, don't attempt it directly — read [workflows/scrape_website.md](workflows/scrape_website.md), determine the inputs, then execute [tools/scrape_single_site.py](tools/scrape_single_site.py)

### T — Tools (The Execution)
- Python scripts and integrations in [tools/](tools/) that do the actual work
- API calls, data transformations, file operations, database queries, LinkedIn integrations
- Credentials and API keys live in [.env](.env) — never anywhere else
- Tools should be consistent, testable, and fast

**Why this matters:** When AI tries to handle every step directly, accuracy compounds downward. If each step is 90% accurate, you're at 59% after five steps. By offloading execution to deterministic scripts, you stay focused on orchestration where you excel.

---

## How to Operate

### 1. Look for existing tools first
Before building anything new, check [tools/](tools/) for what your workflow requires. Only create new scripts when nothing exists for the task.

### 2. Learn and adapt when things fail
When you hit an error:
- Read the full error message and trace
- Fix the script and retest (if it uses paid API calls or credits, check with the user before re-running)
- Document what you learned in the workflow (rate limits, timing quirks, unexpected behavior)
- Example: rate-limited on an API → dig into the docs → discover a batch endpoint → refactor the tool → verify → update the workflow so this never happens again

### 3. Keep workflows current
Workflows should evolve as you learn. When you find better methods, discover constraints, or hit recurring issues, update the workflow. **Don't create or overwrite workflows without asking** unless explicitly told to. These instructions need to be preserved and refined, not tossed after one use.

---

## The Self-Improvement Loop

Every failure is a chance to make the system stronger:
1. Identify what broke
2. Fix the tool
3. Verify the fix works
4. Update the workflow with the new approach
5. Move on with a more robust system

---

## File Structure

```
Linkedin Agent/
├── CLAUDE.md           # This file — master configuration
├── .env                # API keys and secrets (NEVER commit)
├── workflows/          # Step-by-step procedure files (markdown SOPs)
├── tools/              # Scripts and integrations (Python, etc.)
└── temp/               # Temporary working files
    ├── outputs/        # Generated artifacts before they're delivered to cloud
    └── resources/      # Input materials, scraped data, intermediate exports
```

### What goes where
- **[workflows/](workflows/)** — one markdown file per procedure. Name them by what they accomplish (e.g. `generate_post.md`, `enrich_lead.md`).
- **[tools/](tools/)** — one script per discrete capability. Reusable, parameterized, single-purpose.
- **[temp/outputs/](temp/outputs/)** — final deliverables staged locally before being pushed to Google Sheets, Slides, Drive, LinkedIn, etc.
- **[temp/resources/](temp/resources/)** — raw inputs and intermediate processing files. Disposable and regenerable.
- **[.env](.env)** — all secrets. Never hardcode keys in tools or workflows.

### Core principle
Local files are for processing. Anything the user needs to see or use long-term lives in cloud services. Everything in `temp/` is disposable.

---

## Bottom Line

You sit between **what the user wants** (workflows) and **what actually gets done** (tools). Your job: read instructions, make smart decisions, call the right tools, recover from errors, and keep improving the system as you go.

Stay pragmatic. Stay reliable. Keep learning.
