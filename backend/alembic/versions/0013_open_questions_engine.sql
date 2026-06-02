-- 0013 open_questions_engine  (M21 — BET #4)
--
-- Two coupled capabilities land here:
--   SLICE 1 — Open Question Engine (OQE): a persistent, deduplicated,
--             owner-routed queue of the project's TRUE decision-BLOCKING
--             unknowns. This is the data home for that queue. It MIRRORS the
--             M6 `findings` table shape (see 0005_findings_table.sql) so the
--             inbox UI + accept/dismiss persist pattern can be reused 1:1.
--   SLICE 2 — Decision Closer: needs only a provenance backlink on
--             `decisions` so a Confirm-written decision row can point back at
--             the advisory manager_actions.output draft it came from.
--
-- Design-rule alignment (CLAUDE.md):
--   * AI output stays advisory. `open_questions` rows are the *materialized*
--     advisory queue (like findings), NOT a mutation of the task graph. The
--     human verdict writes back to manager_actions.{accepted_by_human,
--     human_feedback} exactly as findings.respond() does.
--   * A resolved unknown lands as a HUMAN-GATED artifact OR decision — the
--     queue links to whichever via resolution_artifact_id / resolution_decision_id
--     and then re-derives. The AI never writes those resolution rows itself.
--   * Decisions table has NO status column and `decision` is NOT NULL, so an
--     OPEN/undecided decision can never live in `decisions`. The Decision-Closer
--     DRAFT therefore lives in manager_actions.output until Confirm; this
--     migration only adds the provenance column the Confirm write populates.
--
-- SINGLE-TENANT SCOPING NOTE (migration 0009):
--   The app is single-tenant; the backend connects via service-role and RLS is
--   off-path for AI orchestration. There is NO workspace_id column on
--   open_questions by design — every query MUST scope by project_id EXPLICITLY
--   (mirrors findings). RLS policies below are the permissive single-tenant
--   "any authenticated" shape from 0009 so the frontend's Supabase-JS reads work.
--   >>> If multi-tenancy returns: add `workspace_id uuid` (denormalized from
--   >>> projects, like users/projects carry it) + a workspace-scoped RLS policy
--   >>> of the pre-0009 form, and add workspace_id to the candidate/dedupe queries.

-- ── SLICE 1: open_questions queue ─────────────────────────────────────
create table if not exists public.open_questions (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null references public.projects(id) on delete cascade,

  -- The framed, decision-blocking unknown + the bilingual outreach draft.
  question               text not null,                 -- the exact question to get answered (primary language / framing)
  question_zh            text,                           -- bilingual framing (optional; question holds the canonical text)
  question_en            text,
  drafted_message_zh     text,                           -- ready-to-send outreach (e.g. to a Yiwu supplier), ZH
  drafted_message_en     text,                           -- ready-to-send outreach, EN

  -- Provenance: which SQL candidate seeded this question. EXACTLY ONE of
  -- source_task_id / source_decision_id is set per the two candidate rules:
  --   (a) blocked/in_progress task with >=1 downstream dependent
  --   (b) decision with review_at < now() and empty reasoning
  source_task_id         uuid references public.tasks(id) on delete cascade,
  source_decision_id     uuid references public.decisions(id) on delete cascade,

  -- Routing: ONE card to the responsible human. tasks.owner_id is the REAL key.
  target_owner_id        uuid references public.users(id) on delete set null,

  -- Unblock blast radius: "answering this releases these N named tasks".
  -- Shape: {"released_task_ids": [uuid...], "count": int}. Names resolved at read time.
  blast_radius           jsonb not null default '{"released_task_ids": [], "count": 0}'::jsonb,

  -- Lifecycle. Mirrors findings.status semantics:
  --   open      — derived, not yet routed/seen
  --   routed    — surfaced to target_owner_id (the human checkpoint)
  --   answered  — human supplied the real-world answer; resolution_* points at the gated row
  --   dismissed — human rejected as noise; dismiss_reason trains the filter
  status                 text not null default 'open'
                         check (status in ('open','routed','answered','dismissed')),

  -- Feedback-loop signal source. dismiss_reason chips: 'not_blocking' /
  -- 'already_known' (+ free text) feed llm.recent_feedback() to train the noise filter.
  dismiss_reason         text,
  feedback_note          text,

  -- Resolution lands as a HUMAN-GATED row (artifact OR decision). The AI never
  -- writes these; the human's Answer/Confirm action does, then the queue re-derives.
  resolution_artifact_id uuid references public.artifacts(id) on delete set null,
  resolution_decision_id uuid references public.decisions(id) on delete set null,

  -- Audit + feedback backlink (the single generate() call that framed/drafted this batch).
  manager_action_id      uuid references public.manager_actions(id) on delete set null,

  -- Dedupe situation embedding (pure vector math, NOT a per-candidate LLM call).
  -- Same dim/space as artifacts.embeddings so the queue can be compared against
  -- both open questions AND artifacts with `embeddings <=> cast(:v as vector)`.
  embedding              vector(1536),

  created_at             timestamptz not null default now(),
  resolved_at            timestamptz
);

-- Inbox read path: queue for a project by status, newest first (mirrors findings_project_status_idx).
create index if not exists open_questions_project_status_idx
  on public.open_questions (project_id, status, created_at desc);

-- "My open cards" routing read (mirrors findings_target_owner_idx).
create index if not exists open_questions_target_owner_idx
  on public.open_questions (target_owner_id, status)
  where status in ('open','routed');

-- Source backlinks (re-derive / overlap checks scope by these).
create index if not exists open_questions_source_task_idx
  on public.open_questions (source_task_id)
  where source_task_id is not null;
create index if not exists open_questions_source_decision_idx
  on public.open_questions (source_decision_id)
  where source_decision_id is not null;

-- STABLE DEDUPE IDENTITY (cross-run, non-overlapping with the stateless weekly
-- optimizer). At most ONE *currently-live* question per source candidate, so a
-- re-run finds the existing card instead of inserting a duplicate. Resolved/
-- dismissed history is preserved (predicate excludes terminal states), so the
-- same source can legitimately resurface a NEW card after it was answered.
create unique index if not exists open_questions_uniq_live_source_task_idx
  on public.open_questions (source_task_id)
  where source_task_id is not null and status in ('open','routed');
create unique index if not exists open_questions_uniq_live_source_decision_idx
  on public.open_questions (source_decision_id)
  where source_decision_id is not null and status in ('open','routed');

-- pgvector dedupe scan over the queue's situation embeddings (cosine).
create index if not exists open_questions_embedding_hnsw_idx
  on public.open_questions using hnsw (embedding vector_cosine_ops);

alter table public.open_questions enable row level security;

-- Single-tenant permissive policy (0009 shape). Frontend reads via Supabase-JS
-- (RLS-enforced); backend orchestration uses service-role (bypasses RLS).
create policy "any auth access open_questions"
  on public.open_questions for all to authenticated
  using (true) with check (true);

-- ── SLICE 2: Decision Closer provenance ───────────────────────────────
-- `decisions` has NO metadata/jsonb column (verified live), so provenance gets
-- its own minimal nullable FK. When Confirm writes a real decisions row from a
-- Decision-Closer draft, it sets this to the manager_actions.id whose output
-- held the advisory draft. Nullable + ON DELETE SET NULL ⇒ zero impact on the
-- thousands of organic decisions that have no AI provenance.
alter table public.decisions
  add column if not exists source_manager_action_id uuid
  references public.manager_actions(id) on delete set null;

create index if not exists decisions_source_manager_action_idx
  on public.decisions (source_manager_action_id)
  where source_manager_action_id is not null;
