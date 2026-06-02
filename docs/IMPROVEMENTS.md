# Improvement Proposal

> Review pass on a fully-shipped codebase (M0–M11). Polish + leverage, not a rescue.
> Scope chosen by the founder: **(A) correctness/robustness, (B) product/UX, (C) innovative functionality.**
> Tenancy and test/CI gaps were de-prioritized — see [Flagged](#flagged-not-proposed-as-work).
>
> Effort key: **S** ≤2h · **M** ~half-day · **L** ~1–2d. Nothing here violates the design rules in
> [`../CLAUDE.md`](../CLAUDE.md) (advisory-only AI, `[stable_system, state, query]` prompt shape,
> ≤3-call loop cap, coaching isolation). Pick items to implement on this branch.

## Status (this branch)

**All items implemented.** See [`CHANGES_REPORT.md`](./CHANGES_REPORT.md) for the full write-up.

- **A1** assert→HTTP errors · **A2** dependency-cycle protection (+tests) · **A3** idempotent meeting
  spawn (migration `0012`) · **A4** optimizer truncation note · **A5** budget fail-open logging
- **B1** clean API error messages (+tests) · **B2** nav count badges · **B3** keyboard nav (T/F/O/M) ·
  **B4** `lang` a11y on bilingual text · **B5** dark mode (toggle + `.dark` palette)
- **C1** Manager Daily Brief (prompt + endpoint + overview card) · **C2** — *deferred*, see report ·
  **C3** Manager-learning insights (endpoint + page + nav tab)

Backend `pytest` **81 passing**; frontend `tsc` clean + **15 vitest passing**. Migration `0012` and the
production deploy still need to be applied (see report's "Deploy checklist").

## A — Correctness & Robustness

| # | Item | Where | Why | Effort |
|---|------|-------|-----|--------|
| A1 | Replace `assert ... is not None` not-found checks with `HTTPException` | `backend/app/api/{generate,meetings,artifacts,optimizer}.py`, `backend/app/db.py` | Missing project / failed audit insert raises `AssertionError` → **HTTP 500** not 404/409; `python -O` strips asserts entirely | M |
| A2 | Detect dependency cycles before wiring the task DAG | `backend/app/api/generate.py` (`persist_tasks` edge insert) | LLM-proposed `A→B→A` is inserted unchecked and corrupts the DAG the optimizer/kanban traverse | M |
| A3 | Make recurring-meeting spawning idempotent | `backend/app/workers/spawn_recurring_meetings.py` + new migration | "read `last_spawned_at` → INSERT → UPDATE" has a TOCTOU window → duplicate meetings on double-fire; UPDATE bumps even if INSERT failed. Fix: unique `(template_id, scheduled_date)` + `ON CONFLICT DO NOTHING` | M |
| A4 | Surface "showing N of M tasks" instead of silent truncation | `backend/app/api/optimizer.py` (`limit 80`), state builders | Over-cap projects drop tasks silently; AI advises on a partial picture with no signal | S–M |
| A5 | Log when the workspace budget lookup fails (don't fail-open silently) | `backend/app/middleware/rate_limit.py` (`_resolve_workspace_id`) | A DB hiccup silently disables the per-workspace daily $ cap; at minimum emit a warning so a sustained outage is visible (per-user cap still bounds it) | S |

## B — Product & UX

| # | Item | Where | Why | Effort |
|---|------|-------|-----|--------|
| B1 | Route API errors through `extractError` instead of leaking raw bodies | `frontend/src/lib/api.ts` (throws `` `${status} ${statusText}: ${rawBody}` ``); `extract-error.ts` already exists | Raw FastAPI error JSON/stack surfaces in the UI; one change benefits every panel | S |
| B2 | Wire up the nav count badges | `frontend/src/app/projects/[id]/project-tabs.tsx` (`count?` defined + rendered, never populated) | Open-findings / pending-tasks / today's-meetings counts are the cheapest "needs attention" signal; use existing RLS-enforced Supabase reads | M |
| B3 | Extend keyboard-driven review to Kanban + findings | ProposalReview already has per-card keydown (`ProposalReview/index.tsx`); board/findings don't | Power-user flow consistency; reuse the existing `Kbd` + keydown pattern | M |
| B4 | Accessibility pass on Almanac primitives | `frontend/src/components/almanac/{Glyph,Bi}.tsx`, icon-only buttons | Unlabeled glyphs + no `lang` attrs on bilingual spans → inconsistent screen-reader output | M |
| B5 | (Optional) Dark mode | `tailwind.config.ts` (no `darkMode`), `globals.css` (already CSS-variable themed) | Variable-based theming makes this a `dark` variant + toggle; polish, not a gap | M |

## C — Innovative Functionality (leans into the thesis)

The thesis is *"one canonical state + a Manager Agent on top of it."* Today the AI features are **siloed per
tab** and the rich `manager_actions` audit trail is **write-only**. These reuse the established recipe
(`prompts/*_system.md` + `routing.py` + `llm.build_messages` + `llm.recent_feedback` + Accept/Edit/Reject).

- **C1 · Manager Daily Brief (L)** — one endpoint + overview panel that synthesizes *across* state in a single
  pass (stale/blocked tasks, undismissed findings, this week's optimizer risks, upcoming meetings) into a
  prioritized brief with deep links. The Manager Agent actually *operating on top of* the state instead of the
  user hopping between four tabs. New `prompts/daily_brief_system.md` + `"daily_brief"` route + `api/brief.py`,
  surfaced on `/projects/[id]`. Highest moat payoff, pure reuse, 1 model call. **Recommended flagship.**
- **C2 · Semantic ⌘K search (L)** — global command-palette over tasks/artifacts/decisions/findings. pgvector +
  `llm.embed` + the `discover_findings` chunking pipeline already exist; extend embeddings beyond artifacts and
  add a `<=>` similarity endpoint + palette UI (no global search exists today).
- **C3 · "Manager is learning" panel (M)** — read-only dashboard over `manager_actions`: accept/edit/reject
  rates per `action_type` over time, rejection reason-chip distribution, daily spend vs cap (reuses
  `budget.spent_today_usd`). Makes the compounding feedback loop (design rule #2) visible. No new LLM cost.

## Flagged (NOT proposed as work)

- **Tenancy/RLS drift:** `0009_simplify_rls_single_tenant.sql` dropped all workspace isolation (any
  authenticated user reads/writes any non-coaching row), yet `CLAUDE.md` rule #1 and `README.md` still say
  "multi-tenant via RLS", and `llm_budget_daily_usd` is still *per-workspace* while spend is effectively global.
  `current_workspace_id()` is orphaned. Fine for the trusted fanpo team; a blocker before multi-tenant/commercial
  use. **Recommend a one-paragraph trust-model note in `CLAUDE.md`/`README.md`** so it isn't mistaken for a bug.
  (coaching_sessions per-user isolation is intact — verified.)
- **Tests/CI:** ~15–20% backend coverage (no endpoint integration tests, `deps.py` JWT path + workers untested);
  CI lacks frontend eslint, a migration smoke-run, and security scanning.

## Suggested sequencing

1. Quick wins: **A1 · B1 · A5 · B2** (low risk, high value).
2. Flagship: **C1 — Daily Brief** (best thesis payoff).
3. Then **A2 · A3 · B3 · B4** for robustness/polish; **C2 · C3** to invest in the moat.

## Verification (when items are implemented)

- Backend: offline `pytest` (mock the LLM as `test_manager.py` / `test_tag_suggestion.py` do); `ruff check app/`.
- Migrations: apply via Supabase MCP, save SQL + `.py` wrapper under `backend/alembic/versions/`, regenerate
  `frontend/src/lib/db-types.ts`.
- Frontend: `pnpm typecheck && pnpm test`; extend the Playwright smoke (`frontend/tests/e2e/run-thru.spec.ts`).
