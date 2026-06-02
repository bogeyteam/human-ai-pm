# Change Report — Code-review improvements

Branch: `claude/code-review-improvements-hqWVb`. This pass turned the
[improvement proposal](./IMPROVEMENTS.md) into shipped code: five robustness
fixes (A), five UX improvements (B), and two new AI-leverage features (C).
One proposed item (C2, semantic search) is deferred — see [Deferred](#deferred).

**Verified:** backend `pytest` **81 passing**, `ruff` clean on changed files (only
the repo-wide pre-existing `B008` FastAPI-`Depends` notices remain); frontend
`tsc --noEmit` clean, **15 vitest passing**. Migrations and prod deploy still
need applying — see [Deploy checklist](#deploy-checklist).

---

## A — Correctness & robustness

### A1 · Proper HTTP errors instead of `assert`
`assert x is not None` checks became explicit `HTTPException`s across
`api/generate.py`, `meetings.py`, `optimizer.py`, `artifacts.py`, `coaching.py`,
and a `RuntimeError` in `db.py`. Missing projects now return **404**; internal
"this row must exist" failures return **500**.
**User expectation:** opening a deleted/invalid project gives a clean "Project
not found" message instead of an opaque 500, and the checks no longer vanish
under `python -O`.

### A2 · Task-dependency cycle protection
`persist_tasks` now filters LLM-proposed dependency edges through
`acyclic_dependency_edges()` (new, unit-tested in `test_dependency_cycles.py`);
self-loops and cycle-closing edges are skipped and logged.
**User expectation:** accepting AI tasks can no longer create a circular
dependency (A→B→A) that would make the optimizer/board ordering loop. Skipped
edges are dropped silently from the user's view (logged server-side).

### A3 · Idempotent recurring-meeting spawning
New migration **`0012_meetings_template_slot_uniq`** adds a partial unique index
on `meetings(template_id, scheduled_at)`; the spawner uses `ON CONFLICT DO
NOTHING` and only advances `last_spawned_at` when a row was actually inserted.
**User expectation:** a double cron tick (or a second backend replica) no longer
produces duplicate meeting instances. *Requires migration 0012 before deploy.*

### A4 · Honest backlog truncation
The optimizer's project-state snapshot now says **"Showing the top N of M active
tasks"** when the backlog exceeds the 80-task cap.
**User expectation:** on large backlogs, the optimizer's recommendations are
explicitly scoped to the tasks it actually saw, rather than silently ignoring
the overflow.

### A5 · Budget fail-open is now visible
When the rate limiter's per-workspace lookup fails, it still fails open (a DB
hiccup won't block traffic) but now logs a warning.
**User expectation:** no behavior change for users; operators get a log signal
if a sustained outage ever disables the daily $ cap.

---

## B — Product & UX

### B1 · Clean API error messages
`frontend/src/lib/api.ts` now parses FastAPI `detail` (string or Pydantic
validation array) into a human message and logs the raw body to the console
instead of surfacing it. (Tests updated in `api.test.ts`.)
**User expectation:** errors read as "Project not found." or "field required"
rather than `404 Not Found: {"detail":...}`.

### B2 · Live nav count badges
The project layout fetches open-task and open-finding counts and passes them to
the sidebar/mobile nav (the `count` field that was reserved in V1 is now wired).
**User expectation:** the **Tasks** and **Findings** nav items show a live count
of open items.

### B3 · Keyboard navigation
The **T / F / O / M** hints already shown on the Daily nav items now work —
pressing them jumps to Tasks / Findings / Optimizer / Meetings. Ignored while
typing in a field or when a modifier key is held.
**User expectation:** single-key tab switching from anywhere in a project.

### B4 · Bilingual accessibility
The `Bi` primitive now wraps Chinese text in `lang="zh"` and the English gloss
in `lang="en"`.
**User expectation:** screen readers pronounce each language correctly; no
visual change.

### B5 · Dark mode
Tailwind colors now resolve from the Almanac CSS variables (light mode is
byte-identical), a `.dark` palette was added to `globals.css`, a no-flash init
script lives in the root layout, and a **Light/Dark toggle** sits in the project
sidebar (next to the ⌘K hint). Choice persists in `localStorage`.
**User expectation:** a working dark theme toggle. ⚠️ The dark palette has not
been visually QA'd in a browser in this environment — give it a once-over after
deploy (see [Notes](#notes--risks)).

---

## C — New AI-leverage features

> Both reuse the established recipe (`prompts/*_system.md` + `routing.py` +
> `llm.build_messages` + `llm.recent_feedback` + advisory output). Nothing
> auto-mutates the task graph.

### C1 · Manager Daily Brief *(flagship)*
- **Backend:** `prompts/daily_brief_system.md`, `"daily_brief"` route in
  `routing.py`, `api/brief.py` with `POST /api/projects/{id}/daily_brief`
  (synthesizes blocked tasks, stale in-progress work, open findings, recent
  optimizer risks, and upcoming meetings into one prioritized brief) and
  `POST …/daily_brief/feedback` (useful/not-useful, feeding the feedback loop).
  Rate-limited like other LLM routes; audited in `manager_actions`.
- **Frontend:** `DailyBriefCard` at the top of the project **Overview**, with
  priority-ordered items that deep-link to the relevant tab, plus a useful/not
  feedback control.
- **User expectation:** an on-demand "what needs attention today" digest on the
  Overview page — the Manager Agent reading the whole project state at once,
  instead of the user checking four tabs. It costs one LLM call per generation,
  so it's a button, not auto-run.

### C3 · "Manager is learning" insights
- **Backend:** `api/insights.py` — `GET /api/projects/{id}/insights`, a
  read-only aggregate (no LLM) of accept/reject rates per action type, weekly AI
  activity, rejection reason-chip distribution, and today's spend vs the cap.
  Helpers unit-tested in `test_insights.py`.
- **Frontend:** a new **Insights / 洞察** tab (`/projects/[id]/insights`) with
  headline stats, a spend gauge, per-action-type accept/reject bars, an 8-week
  activity chart, and the top rejection reasons.
- **User expectation:** a dashboard that makes the feedback loop visible — you
  can see the AI's acceptance rate climb as you give feedback, and watch daily
  spend against the budget.

---

## Deploy checklist

1. **Apply migration 0012** (additive, safe) via the Supabase MCP / `alembic
   upgrade head`. The idempotent spawner's `ON CONFLICT` depends on the new
   unique index — ship the migration with (or before) the backend.
2. **Deploy backend** (Railway) — new routers are registered in `app/main.py`.
   No new env vars or model keys; `daily_brief` uses the existing Moonshot key.
3. **Deploy frontend** (Vercel) — no new env vars.
4. **Smoke test:** open a project → generate a Daily Brief → open the Insights
   tab → toggle dark mode → press T/F/O/M.

## Deferred

**C2 · Semantic ⌘K search** was scoped but intentionally not shipped here. It
requires (a) embedding columns + a backfill for tasks/decisions, (b) a pgvector
similarity endpoint, and (c) a ⌘K palette. Steps (a)/(b) can only be exercised
against live pgvector + the Qwen embedding API, so it can't be verified in this
sandbox, and shipping search that silently returns nothing would be worse than
not shipping it. Ready-to-build plan: extend `llm.embed` usage to task/decision
text (mirror `workers/discover_findings.py` chunking), add a `match_*` query
using the `<=>` operator, and wire the existing ⌘K hint to a palette. Happy to
implement on request.

## Notes & risks

- **Dark mode** needs a visual QA pass in a real browser; the palette is
  conservative but unverified here. Light mode is unchanged (the Tailwind colors
  now point at the same CSS-variable values).
- **Tenancy reminder (unchanged):** the app is effectively single-tenant since
  migration `0009`, while `CLAUDE.md`/`README.md` still say "multi-tenant via
  RLS" and the budget cap is per-workspace. Not touched here — flagged in the
  proposal as out of chosen scope.
