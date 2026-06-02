# Human-AI Project Manager — orientation for AI assistants

> **Read this first when picking up the repo.** It collapses everything an AI needs to know about the system layout, where it runs, and the design rules. Keep this file under ~250 lines; deeper detail lives in `docs/PLAN.md` and `PRD.md`.

## What this is

A self-hosted, open-source project management tool built around one idea: AI should advise, humans should decide. One canonical project state + a Manager Agent on top. Every AI output is advisory. Every verdict feeds back into the next AI call.

Built incrementally as 11 milestones M0–M11 in `docs/PLAN.md`. See `README.md` for full setup guide.

## Your deployment

Fill this in once you've deployed:

| Layer | Platform | URL |
|---|---|---|
| **Frontend** | Vercel | `https://<your-project>.vercel.app` |
| **Backend** | Railway | `https://<your-project>.up.railway.app` |
| **Database** | Supabase | `https://<your-ref>.supabase.co` |

### Useful one-liners
- Read Railway logs: `railway logs --service <service-name>`
- Regenerate DB types after a migration: run `mcp__claude_ai_Supabase__generate_typescript_types`, write to `frontend/src/lib/db-types.ts`
- Apply DB migration: use `mcp__claude_ai_Supabase__apply_migration`. Always also save the SQL to `backend/alembic/versions/NNNN_<name>.sql` + a thin `.py` wrapper.

## Architecture in 60 seconds

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Next.js 14 App Router on Vercel/Tokyo)   │
│  - Magic-link auth via Supabase Auth                │
│  - CRUD via Supabase JS direct (RLS enforced)       │
│  - AI calls → Backend with Bearer JWT               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  Backend (FastAPI on Railway/US East)               │
│  - Verifies JWT via Supabase JWKS (RS256)           │
│  - LLM gateway: app/llm/manager.py                  │
│    * Moonshot (Kimi) for generation                 │
│    * Qwen for embeddings + cross-task LLM filter    │
│  - Writes manager_actions audit row per AI call     │
│  - Per-workspace daily LLM budget cap               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│  Supabase (Postgres + pgvector + Auth + Storage)    │
│  - 13 tables, all RLS-locked by workspace           │
│  - artifacts.embeddings vector(1536)                │
│  - manager_actions = audit trail + RL signal source │
└─────────────────────────────────────────────────────┘
```

## Schema (PRD §5 + 6 migrations on top)

Source of truth: SQL files in `backend/alembic/versions/000{1..6}_*.sql`. Tables:

| Table | Purpose |
|---|---|
| `workspaces` | Multi-tenant root. `+llm_budget_daily_usd` (cost cap) |
| `users` | Mirrors `auth.users` 1:1 via auto-trigger. `workspace_id` nullable |
| `projects` | One workspace ⇒ many projects |
| `tasks` | The task graph. Status enum: backlog/ready/in_progress/blocked/done/dropped |
| `task_dependencies` | DAG edges |
| `artifacts` | Docs/links/files. **Has both `task_id` (nullable) AND `project_id` (required)** — added in M6 because PRD §5 left unlinked artifacts homeless |
| `messages` | Communications log |
| `decisions` | Explicit decision log (PRD §5) |
| `coaching_sessions` | **Strictly private per user** — even founders can't read. V1 feature (no code yet) but isolation real from day one |
| `meetings` | Meeting orchestrator (M11). `agenda jsonb`, `notes text`, `ai_pre_brief`, `ai_post_summary` |
| `manager_actions` | **Audit trail + RL signal source**. Every AI call writes here. `human_feedback jsonb` drives the feedback loop |
| `findings` | Cross-task discovery output (M6). One-to-many `findings` per `manager_action` |

RLS helper: `public.current_workspace_id()` — SECURITY DEFINER, returns the caller's workspace_id, used in every workspace-scoped policy.

## Design rules — DO NOT VIOLATE

1. **Multi-tenant via RLS, not API checks.** Every query must work against an RLS-locked table. Service-role bypass is only for backend-orchestrated AI writes.
2. **AI outputs are advisory.** Nothing auto-mutates the task graph. Every output goes through Accept / Edit / Reject UI; result writes back to `manager_actions.accepted_by_human` + `human_feedback` as structured JSON.
3. **Feedback loop is real.** Every AI call of the same `action_type` for the same project pulls recent `manager_actions` rows with feedback into its system prompt — see `llm.recent_feedback()`. This is the cheap "RLHF" that compounds over time.
4. **Loop cap ≤3 model calls** before human checkpoint. No agentic auto-loops.
5. **`coaching_sessions` isolation is sacred.** Different RLS policy from everything else (`user_id = auth.uid()`). Never lift this.
6. **Prompt shape** (cache-friendly): `[stable_system, project_state_snapshot, user_query]`. Stable + state stays cacheable across calls.
7. **No LiteLLM, no Feishu.** Both were considered and dropped (LiteLLM: maintenance concerns; Feishu: team doesn't use it). See `docs/PLAN.md`.
8. **Schema deviations from PRD §5 are explicit migrations.** Three so far, all in `alembic/versions/`. Don't sneak in column additions.

## How to add a new AI capability (the recipe)

Mirrors M5/M6/M7/M11. Reuse, don't re-invent:

1. Write `backend/app/llm/prompts/<name>_system.md`. Include the JSON output shape + a "Feedback-loop instruction" section.
2. Add an entry to `backend/app/llm/routing.py` keyed by your `task_type`.
3. Implement in `backend/app/api/<name>.py`:
   - Pull recent feedback via `llm.recent_feedback(session, project_id, "<action_type>")`
   - Build messages with `llm.build_messages(stable_system, project_state + feedback_block, user_query)`
   - Call `llm.generate(task_type="<task_type>", ...)` — it auto-writes to `manager_actions`
   - Return proposals as-is (no auto-mutation)
4. Add a frontend page + client panel with Accept / Edit / Reject + bilingual reason chips. Post user verdicts back to a `persist_*` endpoint that updates `manager_actions.accepted_by_human` and `human_feedback`.
5. Register the router in `backend/app/main.py` and the tab in `frontend/src/app/projects/[id]/project-tabs.tsx`.

Templates: `backend/app/api/generate.py` (M5) and `frontend/src/components/BrainstormToTasks.tsx` are the canonical references.

## Gotchas accumulated in production

- **SQLAlchemy `text()` + Postgres `::type` cast** — collides with `:param` bind syntax. Use `cast(:x as type)` instead. Bit us in M11 pre-brief save.
- **Supabase pooler vs direct DB connection** — use the Session Pooler URL (`aws-1-ap-northeast-1.pooler.supabase.com:5432` with username `postgres.<project-ref>`), not `db.<ref>.supabase.co:5432`. Direct connection fails on Mac because of iCloud Private Relay hijacking `198.18.0.0/15`.
- **Supabase Auth JWT** — project is on the new asymmetric (RS256) key system. Backend verifies via JWKS endpoint at `https://<project>.supabase.co/auth/v1/.well-known/jwks.json`. Falls back to legacy HS256 + shared secret if needed. See `backend/app/deps.py`.
- **Railway builder** — uses Railpack now, not Nixpacks. A `Dockerfile` in `backend/` is the most reliable way to control the build; `nixpacks.toml` is ignored.
- **Qwen embedding limit** — `text-embedding-v2` caps inputs at 2048 tokens. The discovery worker (`backend/app/workers/discover_findings.py`) chunks long docs at ~3500 chars + mean-pools the vectors.
- **Vercel env var paste** — long anon keys can pick up line-break artifacts when pasted into the dashboard. Verify the stored value has no whitespace mid-string after each paste.
- **Frontend uses Supabase JS for reads** (RLS-enforced), backend for AI orchestration (service-role bypass). Don't mix.

## When you're stuck

- Backend logs: `railway logs` or check your hosting platform's dashboard
- DB queries / RLS debug: use Supabase Studio or `mcp__claude_ai_Supabase__execute_sql` (service role, bypasses RLS)
- `manager_actions` table is the AI's audit trail. To debug an AI flow that "did the wrong thing," start there.
- `docs/PLAN.md` has the original milestone-by-milestone plan. `PRD.md` is the product spec.
