# AI Manager Platform — MVP Implementation Plan

> **Status (2026-05-13)**: M0–M11 shipped end-to-end. Live in production:
> Frontend on **Vercel** (`hnd1` Tokyo) at https://ai-product-manager-self.vercel.app ·
> Backend on **Railway** (US East) at https://ai-product-manager-production.up.railway.app ·
> Database on **Supabase** (`ap-northeast-1` Tokyo) `ryvrpwraoccjofpsgclz` ·
> Source on **GitHub** at https://github.com/bogeyteam/ai-product-manager.
> See [`../CLAUDE.md`](../CLAUDE.md) for an AI-agent orientation pass.
>
> M8 (Feishu sync) was dropped; M11 (Meetings) was added post-MVP. The plan below is the original sequencing — keep it as history. New work should reference CLAUDE.md and append a new section here.

## Context

We're building the v0.1 MVP of an AI Manager Platform for small (3-15 person) cross-border DTC teams, dogfooded against the founder's "fanpo" team. The thesis (validated by both the PRD and the research artifact at `claude.ai/public/artifacts/db38954f-acdc-4afa-81d5-b0c40ad10142`): the moat is **a single canonical project state + a Manager Agent that operates on top of it**, not any individual feature. AI features bolted onto Linear/Asana lose because they can't share state across capabilities.

Scope confirmed with user: **full MVP per PRD §7** — Phase 0 foundation plus all three MVP features (Task Generator, Cross-task Info Discovery, Weekly Backlog Optimizer), minimal Feishu sync, and a Team Operations Dashboard. The PRD explicitly asks for incremental delivery ("don't write all code at once; tell me before each step"), so this plan is sequenced as numbered milestones with explicit checkpoints, not one giant push.

Three constraints from the research artifact shape the plan beyond what the PRD says:
- **Drop LiteLLM** (research warns against it post-March 2026; today is 2026-05-13). Build a thin in-house wrapper instead.
- **Safe-agent patterns**: every Manager Agent output is advisory, every action logs to `manager_actions`, loops capped at ≤3 steps before human checkpoint.
- **EU AI Act readiness**: coaching is V1 (out of MVP scope) but we still create the isolated `coaching_sessions` table now so the boundary is real from day one.

The PRD says "Schema 严格按第 5 节执行" — schema is frozen and copied verbatim. If anything seems wrong, I flag it first instead of editing.

---

## Stack (locked-in decisions)

| Layer | Choice | Notes |
|---|---|---|
| Backend | Python 3.12 + FastAPI | PRD §8.1 |
| ORM / migrations | SQLAlchemy 2.x + Alembic | PRD §13 step 2 explicitly says Alembic |
| DB | Supabase Postgres + pgvector | Provisioned via Supabase MCP |
| Auth | Supabase Auth (magic link first; OAuth later) | User chose Supabase over Clerk |
| Storage | Supabase Storage | Artifacts > inline text |
| Queue | Postgres-backed (simple `worker_jobs` table + APScheduler in-process) | PRD §8.1 — no Celery for MVP |
| Frontend | Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui | PRD §8.2 |
| Frontend state | TanStack Query + Zustand | PRD §8.2 |
| LLM gateway | In-house `backend/llm/manager.py` | NOT LiteLLM — direct SDKs (Moonshot for generation, Qwen for embeddings, Anthropic optional) |
| Default models | Moonshot `moonshot-v1-128k` (gen), Qwen `text-embedding-v2` (embed) | PRD §9.3 |
| Feishu | `lark-oapi` SDK | PRD §8.3 — minimal: bot + group message sync |
| Hosting (later) | Vercel (FE) + Railway/Fly (BE) + Supabase | Defer; local-first during MVP |

---

## Repo layout

```
/Users/xieziyi/Downloads/ai-pm/
├── PRD.md                       # copy of user's PRD verbatim
├── README.md                    # setup instructions (last step)
├── .env.example
├── .gitignore
├── docker-compose.yml           # optional: only if user wants local Postgres alt
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/
│   │   └── versions/
│   │       └── 0001_initial_schema.py    # PRD §5 verbatim
│   └── app/
│       ├── main.py              # FastAPI entry
│       ├── settings.py          # env vars
│       ├── db.py                # engine + session
│       ├── deps.py              # auth dep, current_workspace dep
│       ├── models/              # SQLAlchemy models (1 file per entity)
│       ├── schemas/             # Pydantic request/response
│       ├── api/
│       │   ├── workspaces.py
│       │   ├── projects.py
│       │   ├── tasks.py
│       │   ├── artifacts.py
│       │   ├── decisions.py
│       │   ├── generate.py      # POST /projects/:id/generate_tasks
│       │   ├── findings.py      # cross-task info discovery
│       │   └── optimizer.py     # weekly backlog optimizer
│       ├── llm/
│       │   ├── manager.py       # generate() + embed() — direct SDK calls
│       │   ├── prompts/         # one .txt per prompt (task_gen, info_discovery, optimizer)
│       │   └── routing.py       # task_type → model map (PRD §9.3)
│       ├── integrations/
│       │   └── feishu.py        # webhook handler + send_message
│       └── workers/
│           ├── embed_artifact.py        # on artifact insert → embedding
│           ├── discover_findings.py     # on task done → cross-task scan
│           └── weekly_optimizer.py      # cron Mon 09:00 local
├── frontend/
│   ├── package.json
│   ├── next.config.js
│   ├── tailwind.config.ts
│   └── src/
│       ├── app/
│       │   ├── (auth)/login/page.tsx
│       │   ├── (app)/projects/[id]/page.tsx           # dashboard
│       │   ├── (app)/projects/[id]/tasks/page.tsx
│       │   ├── (app)/projects/[id]/findings/page.tsx
│       │   └── (app)/projects/[id]/optimizer/page.tsx
│       ├── components/
│       │   ├── ui/                                    # shadcn primitives
│       │   ├── TaskCard.tsx
│       │   ├── FindingCard.tsx
│       │   └── BrainstormToTasks.tsx
│       ├── lib/
│       │   ├── supabase.ts
│       │   └── api.ts
│       └── stores/
├── scripts/
│   ├── seed_fanpo_workspace.py  # quick dogfooding seed
│   └── reset_local.sh
└── docs/
    └── PROMPTS.md               # human-readable copy of all prompts in use
```

---

## Milestone sequence

Each milestone ends at a state I can hand back to the user for review before continuing — per PRD Appendix B's "每次写代码之前，先告诉我你打算怎么做，我 ok 你再写".

### M0 — Repo + PRD checked in (≈30 min)
- Create directory skeleton above
- Copy the full PRD into `PRD.md` verbatim
- Initialize git, write `.gitignore`, write `.env.example` with placeholders for `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MOONSHOT_API_KEY`, `QWEN_API_KEY`, `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `ANTHROPIC_API_KEY`
- **Checkpoint:** show user the tree, confirm before provisioning Supabase

### M1 — Supabase provisioning + schema (≈1 hr)
- Use Supabase MCP `create_project` (will require user to confirm cost via `confirm_cost`)
- Run `list_extensions` and enable `vector` + `pgcrypto`
- Write Alembic env that targets Supabase DSN
- Author `0001_initial_schema.py` with **every table from PRD §5 verbatim**, including:
  - `coaching_sessions` even though coaching is V1 (sets the isolation boundary now)
  - `manager_actions` even though it accrues over time (the RL signal source)
  - `pgvector` index on `artifacts.embeddings`
- Apply via `mcp__claude_ai_Supabase__apply_migration`
- Generate TS types via `generate_typescript_types`, drop in `frontend/src/lib/db-types.ts`
- Add RLS policies: every table scoped by `workspace_id = (select workspace_id from users where id = auth.uid())`; `coaching_sessions` additionally scoped to `user_id = auth.uid()` (no workspace-level read)
- **Checkpoint:** show schema diff + RLS policy list before moving on

### M2 — Backend skeleton + LLM wrapper (≈2 hr)
- FastAPI app with `/healthz`, settings via `pydantic-settings`, async SQLAlchemy session
- `backend/app/deps.py`: `current_user` (verifies Supabase JWT), `current_workspace` (looks up user → workspace)
- `backend/app/llm/manager.py`:
  ```
  async def generate(task_type: str, messages: list[dict], **kwargs) -> str
  async def embed(text: str | list[str]) -> list[list[float]]
  ```
  - `routing.py` maps task_type → (provider, model). Default `task_generation` → Moonshot, `info_discovery` → Qwen, `embeddings` → Qwen.
  - Implements prompt-caching-friendly message shape: `[stable_system] + [project_state_snapshot] + [user_query]` (PRD §9.4)
  - Logs every call (provider, model, tokens, latency, task_type) to `manager_actions` with `input_context`/`output`
- Per-workspace daily LLM budget cap (PRD §9.5: <$10/workspace/month). Hard-stop when exceeded; surface in dashboard.
- **Checkpoint:** call `/healthz` and a `/llm/ping` test endpoint that does one Moonshot round-trip

### M3 — Workspace + project + user CRUD (≈2 hr)
- Endpoints: `POST /workspaces`, `POST /workspaces/:id/invite`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`
- Frontend: login (magic link), workspace bootstrap on first sign-in, project list, project create form (vision, current_stage, preferences JSON)
- **Checkpoint:** I can sign in, create workspace, create project, see it in dashboard

### M4 — Task / artifact / decision CRUD (≈3 hr)
- API endpoints for each entity (list/create/update/delete), all scoped by project + workspace via RLS
- `task_dependencies` join table — exposed as `prereq_ids[]` on task payload
- Frontend: Kanban board (backlog/ready/in_progress/blocked/done/dropped) using `dnd-kit`; artifact panel; decision log page
- Artifact upload goes to Supabase Storage, metadata row in `artifacts` table
- On artifact insert, enqueue `embed_artifact` job
- **Checkpoint:** I can create tasks, drag between columns, attach artifacts, log a decision

### M5 — Feature 6.1 Task Generator + feedback loop (≈4 hr)
- `POST /projects/:id/generate_tasks` accepts `{brainstorm: str, artifact_ids?: uuid[]}`
- Builds prompt per **PRD Appendix A.1** verbatim — pulls project, users, active tasks, recent decisions, attached artifacts
- **Inject prior feedback** into the prompt (the actual learning loop, not just logging):
  - Pull last N (default 20) `manager_actions` rows where `action_type='generate_tasks'` for this project, with non-null `human_feedback` or `accepted_by_human=false`
  - Format as a "Past feedback on your task suggestions" section in the system prompt — both the rejected proposals and the reasons, and the accepted ones (so the model learns positive signal too)
  - This is the cheap, deterministic version of "RL from human feedback" — no fine-tuning, just better in-context priors that compound over time
- Calls `llm.generate(task_type="task_generation", ...)`, parses JSON response
- Returns tasks as **proposals** (not auto-persisted); records one `manager_actions` row per generation batch with `accepted_by_human=null` and a child row per individual proposed task
- **Per-task review UX** (the feedback loop):
  - Modal shows each proposed task with: title, description, est hours, suggested owner, dependencies, AI reasoning
  - Each task has three actions: **Accept** (persists as-is), **Edit** (inline-edit then accept; both original AI version and user edits stored so we learn the delta), **Reject** (requires either picking a reason chip or typing a free-text reason — no silent reject)
  - Reason chips (project-customizable, default set): `已经做过 / Already done`, `阶段不对 / Wrong stage`, `颗粒度太粗 / Too coarse`, `颗粒度太细 / Too granular`, `不该我们做 / Not our scope`, `优先级太低 / Low priority`, `其他 / Other (free text)`
  - On submit: each task's outcome (accept | edit-then-accept | reject + reason) writes back to `manager_actions.human_feedback` as structured JSON
- **Per-batch reflection** (lightweight): after a batch is fully reviewed, surface a one-line summary "AI 这次: 6 accepted, 2 edited, 3 rejected (mostly: 阶段不对)". Just for the user — no auto-action.
- **Safe-agent pattern**: no auto-execution, no auto-assignment, advisory framing throughout
- **Checkpoint:** fanpo brainstorm → AI tasks → I review with reasons → run a SECOND brainstorm and confirm the prompt now contains the prior feedback, and that visibly-improved suggestions come back

### M6 — Feature 6.2 Cross-task Info Discovery + feedback loop (≈4 hr)
- Embedding worker: on artifact insert, generate embedding via `llm.embed`, store in `artifacts.embeddings` (pgvector 1536 — note: Qwen embed dim is actually 1536 for `text-embedding-v2`, confirm before migration)
- Trigger: when `tasks.status` flips to `done`, enqueue `discover_findings(task_id)` job
- Worker:
  1. Pull artifacts produced by this task (linked via `task_id`)
  2. pgvector similarity search of those artifact embeddings against all active task descriptions' embeddings (embed task descriptions lazily and cache)
  3. Top-K (K=5) candidates → batch LLM call per **PRD Appendix A.2** to filter for genuine usefulness; prompt includes prior `info_discovery` feedback history (same pattern as M5) so the model learns this project's definition of "actually useful"
  4. For each `useful_finding`, write to a new `findings` table
  5. Push notification: in-app + Feishu DM to task owner
- Reverse case (new task created → scan existing artifacts): same worker, opposite direction; runs at task creation
- Weekly fallback: full project scan on Sunday night
- **Flag for user approval at this milestone:** the new `findings` table (one new table beyond PRD §5 — flagging because PRD's data model doesn't have a place for AI findings; alternative is `manager_actions` rows, but findings are user-facing artifacts not audit entries). Schema proposal:
  ```sql
  CREATE TABLE findings (
    id UUID PRIMARY KEY,
    project_id UUID,
    source_task_id UUID REFERENCES tasks(id),
    target_task_id UUID REFERENCES tasks(id),
    target_owner_id UUID REFERENCES users(id),
    how_to_use TEXT,
    status TEXT,             -- new, acknowledged, dismissed, linked
    dismiss_reason TEXT,     -- nullable; chip key or free text
    feedback_note TEXT,      -- nullable free text
    created_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
  );
  ```
- Frontend: "Findings" inbox per user. Each finding has three actions:
  - **Acknowledge** (useful, will act on it) — `status=acknowledged`
  - **Useful → link to task** — promotes the finding to an actual sub-task or comment on the target task; `status=linked`
  - **Dismiss with reason** — required chip choice: `不相关 / Not relevant`, `已经知道 / Already knew`, `时机不对 / Wrong timing`, `颗粒度不对 / Wrong granularity`, `其他 / Other (free text)`; `status=dismissed`
- Each outcome writes to `findings` row AND a `manager_actions` row with the same structured feedback, so the next `info_discovery` LLM call can ingest it
- **Checkpoint:** complete a task with a useful artifact → finding appears on another user's dashboard → I dismiss one with reason → trigger another discovery and confirm the model's filter has tightened

### M7 — Feature 6.3 Weekly Backlog Optimizer + feedback loop (≈3 hr)
- APScheduler job runs Monday 09:00 in project timezone
- Pulls full project state snapshot (active tasks, recent decisions, recent artifacts, completed-vs-estimated time, current_stage)
- Prompt includes the last 4 weeks of `manager_actions` rows for `action_type='backlog_optimizer'` with their accept/reject outcomes and reasons — so the optimizer learns this team's actual priorities over time
- Calls `llm.generate(task_type="backlog_optimizer", ...)` with a prompt that outputs:
  - Re-ordered backlog with reasoning
  - Tasks suggested to drop (with why)
  - Tasks suggested to add (with why and gap they fill)
  - This week's critical path
  - "What we need to know to make the next decision"
- Persists as one `manager_actions` row + a `weekly_review` resource the user can open
- Frontend `/projects/:id/optimizer`: each individual suggestion (each re-rank, drop, add) has Accept / Edit / Reject — rejects require a reason chip or free text. Default reject chips: `还需要做 / Still needed`, `优先级判断错了 / Priority misread`, `已经在做 / Already in progress`, `时机不对 / Wrong timing`, `其他`. Accepted suggestions mutate the task graph; rejected/edited ones persist their feedback to `manager_actions.human_feedback`.
- **Checkpoint:** trigger the job manually (test endpoint `POST /projects/:id/optimizer/run`), review output, accept some, reject some with reasons → next manual run shows visibly different (better-calibrated) suggestions

### M8 — DROPPED (2026-05-13)
User decision: no one on the team uses Feishu anymore. Findings + weekly
review summaries surface only in-app (Findings inbox + Optimizer page).
External-channel push can come back later if Slack/Discord adoption justifies it.

### M9 — Team Operations Dashboard polish (≈2 hr)
- Project home: 3 panels — Tasks (compact Kanban), Recent Artifacts feed, Findings inbox
- Top bar: project preferences (speed/quality/cost sliders), stage selector
- Empty states + onboarding hints (research artifact's "cold start" concern from PRD §12.1 — seed project with example tasks/artifacts on first create)
- **Checkpoint:** end-to-end smoke test (see Verification below)

### M10 — README + dogfooding seed (≈1 hr)
- `README.md` covering: setup, env vars, Supabase project creation, running migrations, starting backend (`uvicorn app.main:app --reload`), starting frontend (`pnpm dev`), how to link Feishu, how to trigger the weekly optimizer manually
- `scripts/seed_fanpo_workspace.py`: creates a workspace, the fanpo project, 3 users, ~10 seed tasks across stages, a handful of decisions and artifacts — so dogfooding starts from non-empty state
- **Checkpoint:** README walk-through from scratch on a fresh machine works

---

## Critical files to be modified or created

- `PRD.md` — verbatim copy of user's PRD (M0)
- `backend/alembic/versions/0001_initial_schema.py` — PRD §5 schema (M1)
- `backend/app/llm/manager.py` — `generate()` + `embed()` (M2). Reference `MODEL_ROUTING` from PRD §9.3.
- `backend/app/llm/prompts/task_generation.txt` — PRD Appendix A.1 verbatim (M5)
- `backend/app/llm/prompts/info_discovery.txt` — PRD Appendix A.2 verbatim (M6)
- `backend/app/llm/prompts/backlog_optimizer.txt` — new, modeled on Appendix A structure (M7)
- `backend/app/api/generate.py` — Task Generator endpoint (M5)
- `backend/app/workers/discover_findings.py` — cross-task discovery worker (M6)
- `backend/app/workers/weekly_optimizer.py` — APScheduler job (M7)
- `frontend/src/app/(app)/projects/[id]/page.tsx` — dashboard (M9)
- `frontend/src/components/BrainstormToTasks.tsx` — proposal review UI (M5)
- `frontend/src/components/FindingCard.tsx` — finding inbox card (M6)

## Existing libraries / patterns to reuse (no in-house equivalents to write)

- `supabase-py` for storage operations from backend
- `@supabase/ssr` for Next.js auth integration (Supabase's recommended pattern)
- `shadcn/ui` primitives (Button, Dialog, Tabs, Card) — don't roll our own
- `dnd-kit` for Kanban drag-and-drop
- `apscheduler` for in-process cron (not Celery — PRD §8.1)
- `pgvector` SQLAlchemy types from `pgvector.sqlalchemy`

---

## Design rules to adhere to throughout

1. **Multi-tenant from day one**: every query joins on `workspace_id`, enforced via RLS at DB layer (not just API layer).
2. **Manager Agent outputs are advisory + feedback-looped**: nothing the AI produces auto-mutates the task graph. Every output goes through Accept/Edit/Reject UI; result writes back to `manager_actions.accepted_by_human` + `human_feedback` as structured JSON. **Every subsequent AI call of the same `action_type` for the same project pulls the recent feedback history into its prompt** — so rejections with reasons compound into better future suggestions without any fine-tuning. This rule applies to task generation (M5), cross-task findings (M6), and weekly optimizer (M7).
3. **Loop cap ≤3 steps** before human checkpoint (research artifact). Currently relevant only for the optimizer; document it in `manager.py` so future agents respect it.
4. **`coaching_sessions` isolation**: table exists from M1, has its own RLS (`user_id = auth.uid()`, no workspace-level access). No code in the MVP writes to it, but the boundary is real.
5. **Budget caps**: per-workspace daily LLM spend ceiling configured in `workspaces` table (add `llm_budget_daily_usd numeric` if not in PRD schema — flag this potential addition at M2).
6. **Prompt caching shape**: all LLM calls must pass messages as `[stable_system, project_state, user_query]` so the first two segments stay cache-eligible across calls within a project.
7. **No code generation before user OK**: per PRD Appendix B, I pause at each checkpoint and wait for review before the next milestone.

---

## Verification (end-to-end test scenarios)

After M9 is done, the following manual smoke test should pass:

1. Fresh `pnpm dev` + `uvicorn` on a clean Supabase project
2. Sign in via magic link → land on workspace bootstrap → create workspace "fanpo"
3. Invite a second user (or seed via script)
4. Create project "fanpo 北美 launch" with vision, stage=validation, preferences `{speed:0.4, quality:0.4, cost:0.2}`
5. Paste a 200-word brainstorm into "Generate Tasks from Brainstorm" → confirm ≥5 tasks appear with reasoning → accept 4, reject 1, edit 1 → tasks appear on Kanban
6. Move a task to `in_progress`, attach an artifact (a doc), move to `done`
7. Within ~30 seconds, embedding worker runs + discovery worker runs → a finding appears in the second user's inbox referencing this artifact (only if there's actually a relevant active task; seed script ensures one exists)
8. Trigger weekly optimizer manually via `POST /projects/:id/optimizer/run` → review page populates with re-ranking, drop-suggestions, add-suggestions
9. Open `manager_actions` table in Supabase Studio → confirm every AI output above is logged with input/output/accepted_by_human values

Programmatic checks alongside the smoke test:
- `pytest backend/tests/` — unit tests for `manager.py` (mock SDK), prompt assembly, RLS isolation (write as one user, fail to read as another)
- `pnpm test` — component tests for Kanban + finding card

---

## Out of scope (deliberately deferred)

- 1:1 Coaching (V1 per PRD §6.5 — schema exists but no code)
- People Recommender + Progress Check (V1 — PRD §6.4)
- Meeting Orchestrator (V1 — PRD §6.6)
- Auto Backlog Maintainer (V2 — PRD §6.7)
- Slack / Notion / GitHub integrations (V1+)
- Mobile (V2)
- Model-switching UI (V2 — write Moonshot path now, swap via config)
- SOC2 / GDPR work (V2)

---

## Open questions to resolve as we go (not blockers)

- **`findings` table addition** (M6): one new table beyond PRD §5. Will flag for explicit user OK at M6 before applying the migration.
- **`workspaces.llm_budget_daily_usd` column** (M2): not in PRD §5; needed for the cost-cap design rule. Will flag at M2.
- **Qwen embedding dim**: PRD §5 uses `VECTOR(1536)`; need to confirm Qwen `text-embedding-v2` actually returns 1536-dim (it does for OpenAI but Qwen varies by version). Verify at M1; adjust if needed.
I'll surface each at its milestone rather than blocking the plan now.
