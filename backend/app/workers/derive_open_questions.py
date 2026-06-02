"""Open Question Engine worker (M21 — BET #4, Slice 1).

Pure function `run_derive(session, project_id, workspace_id)` so it can be invoked
from the `/api/projects/:id/questions/derive` endpoint today and a scheduled
nightly sweep later with zero refactor (mirrors `discover_findings.run_discovery`).

Algorithm (loop cap == ONE reasoning call):
  1. Embed any artifacts lacking an embedding (reused from discover_findings) so
     the "already documented" dedupe has something to compare against.
  2. PURE-SQL candidate generation — NO LLM:
       (a) blocked / in_progress tasks with >=1 LIVE downstream dependent,
           ranked by blast count (the unblock blast radius);
       (b) stale decisions: review_at < now() and empty reasoning.
  3. PURE pgvector dedupe (one batched embed + cosine scan) — drop candidates
     already queued (live open_questions) or already documented (artifacts).
  4. ONE generate() call frames the question + drafts bilingual outreach + ranks.
  5. Tolerant-parse, truncate to the top 3 by rank, and upsert. The partial-unique
     live-source indexes (migration 0013) make a re-run a no-op for already-queued
     sources, so the queue is stable and non-overlapping with the weekly optimizer.

owner_id and blast_radius come from the SQL candidate row, NEVER from the model —
the model only frames, drafts, and ranks.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import manager as llm
from app.llm.prompts import load as load_prompt
from app.workers.discover_findings import _embed_missing_artifacts

# Total candidates (tasks + decisions) we let through to the dedupe + LLM per run.
MAX_CANDIDATES = 12
# cosine DISTANCE below which a candidate is treated as a duplicate. These are
# conservative near-dedupe guesses — calibrate against real fanpo dismissals in
# the week-0 dogfood (log nearest-neighbor distances to tune). NOT derived from
# discover_findings' 0.55 (that compares cross-type task<->artifact embeddings).
OPEN_Q_DEDUPE_THRESHOLD = 0.18  # vs a currently-live open_questions situation
ARTIFACT_KNOWN_THRESHOLD = 0.22  # vs an existing artifact (answer likely already written)

_DEFAULT_BLAST: dict[str, Any] = {"released_task_ids": [], "count": 0}


@dataclass
class _Candidate:
    """A pre-selected, pure-SQL blocking-unknown candidate (task or decision)."""

    kind: str  # "task" | "decision"
    source_id: UUID
    headline: str  # task title, or decision question
    context: str  # task description, or the (possibly stale) prior decision answer
    owner_id: UUID | None
    blast_count: int
    blast_radius: dict[str, Any]  # {"released_task_ids": [...], "count": N}
    downstream_titles: list[str]  # named downstream tasks, for the prompt only
    extra: str = ""  # decision-only: "review was due …"
    embedding: list[float] | None = field(default=None)


# ── Candidate generation (PURE SQL, scoped by project_id) ──────────────


async def _task_candidates(session: AsyncSession, project_id: UUID) -> list[_Candidate]:
    """Blocked/in_progress tasks with >=1 LIVE (non-done/non-dropped) downstream
    dependent, ranked by blast count.

    NOTE: `t.priority` in ORDER BY is legal despite not being in GROUP BY only
    because GROUP BY includes the tasks PK (t.id) — priority is functionally
    dependent on it. Don't copy this pattern to a non-PK grouping.
    """
    rows = (
        await session.execute(
            text(
                """
                select t.id, t.title, coalesce(t.description, '') as description,
                       t.status, t.owner_id,
                       count(dep.id) as blast_count,
                       coalesce(
                         jsonb_agg(jsonb_build_object('id', dep.id, 'title', dep.title))
                           filter (where dep.id is not null),
                         '[]'::jsonb
                       ) as downstream
                from public.tasks t
                join public.task_dependencies td on td.prereq_task_id = t.id
                join public.tasks dep
                  on dep.id = td.dependent_task_id
                 and dep.status not in ('done', 'dropped')
                where t.project_id = :pid
                  and t.status in ('blocked', 'in_progress')
                group by t.id, t.title, t.description, t.status, t.owner_id, t.priority
                having count(dep.id) >= 1
                order by blast_count desc, t.priority desc
                limit :lim
                """
            ),
            {"pid": str(project_id), "lim": MAX_CANDIDATES},
        )
    ).all()

    out: list[_Candidate] = []
    for r in rows:
        downstream = r[6] or []
        released_ids = [str(d["id"]) for d in downstream]
        titles = [str(d["title"]) for d in downstream]
        out.append(
            _Candidate(
                kind="task",
                source_id=UUID(str(r[0])),
                headline=r[1],
                context=r[2],
                owner_id=UUID(str(r[4])) if r[4] else None,
                blast_count=int(r[5]),
                blast_radius={"released_task_ids": released_ids, "count": int(r[5])},
                downstream_titles=titles,
            )
        )
    return out


async def _decision_candidates(session: AsyncSession, project_id: UUID) -> list[_Candidate]:
    """Logged decisions whose review_at has passed and whose reasoning is empty —
    a "revisit this" signal. They carry no task linkage, so blast_count == 0."""
    rows = (
        await session.execute(
            text(
                """
                select d.id, d.question, coalesce(d.decision, '') as prior_answer,
                       d.decided_by, d.review_at
                from public.decisions d
                where d.project_id = :pid
                  and d.review_at is not null
                  and d.review_at < now()
                  and coalesce(btrim(d.reasoning), '') = ''
                order by d.review_at asc
                limit :lim
                """
            ),
            {"pid": str(project_id), "lim": MAX_CANDIDATES},
        )
    ).all()

    out: list[_Candidate] = []
    for r in rows:
        out.append(
            _Candidate(
                kind="decision",
                source_id=UUID(str(r[0])),
                headline=r[1],
                context=r[2],
                owner_id=UUID(str(r[3])) if r[3] else None,
                blast_count=0,
                blast_radius=dict(_DEFAULT_BLAST),  # must-fix: decision rows get the default jsonb
                downstream_titles=[],
                extra=f"review was due {r[4]}",
            )
        )
    return out


# ── Dedupe (PURE pgvector cosine — no per-candidate LLM call) ───────────


async def _dedupe(
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
    candidates: list[_Candidate],
) -> list[_Candidate]:
    """Embed candidates once (batched), then drop any whose situation is already
    queued (live open_questions) or already documented (artifacts). Survivors
    carry their embedding forward to the insert (embed-then-insert)."""
    if not candidates:
        return []

    texts = [f"{c.headline}\n{c.context}" for c in candidates]
    vectors = await llm.embed(texts=texts, session=session, workspace_id=workspace_id)

    survivors: list[_Candidate] = []
    for cand, vec in zip(candidates, vectors, strict=True):
        cand.embedding = vec
        # Already queued? (nearest LIVE open_questions situation)
        oq = (
            await session.execute(
                text(
                    """
                    select (embedding <=> cast(:v as vector)) as dist
                    from public.open_questions
                    where project_id = :pid
                      and embedding is not null
                      and status in ('open', 'routed')
                    order by embedding <=> cast(:v as vector)
                    limit 1
                    """
                ),
                {"v": str(vec), "pid": str(project_id)},
            )
        ).first()
        if oq is not None and oq[0] is not None and float(oq[0]) < OPEN_Q_DEDUPE_THRESHOLD:
            continue
        # Already documented? (nearest artifact — the answer is probably written)
        art = (
            await session.execute(
                text(
                    """
                    select (embeddings <=> cast(:v as vector)) as dist
                    from public.artifacts
                    where project_id = :pid and embeddings is not null
                    order by embeddings <=> cast(:v as vector)
                    limit 1
                    """
                ),
                {"v": str(vec), "pid": str(project_id)},
            )
        ).first()
        if art is not None and art[0] is not None and float(art[0]) < ARTIFACT_KNOWN_THRESHOLD:
            continue
        survivors.append(cand)
    return survivors


# ── Feedback block (mirrors discover_findings) ─────────────────────────


async def _build_feedback_block(session: AsyncSession, project_id: UUID) -> str:
    fb_rows = await llm.recent_feedback(
        session, project_id, action_type="open_question", limit=15
    )
    if not fb_rows:
        return ""
    accepted: list[str] = []
    dismissed: list[str] = []
    for r in fb_rows:
        body = r.get("human_feedback") or ""
        verdict = r.get("accepted_by_human")
        if verdict is True:
            accepted.append(body[:600])
        elif verdict is False:
            dismissed.append(body[:600])
    lines: list[str] = []
    if dismissed:
        lines.append("\n## Past dismissed questions")
        lines.extend(f"- {d}" for d in dismissed[:8])
    if accepted:
        lines.append("\n## Recently accepted questions")
        lines.extend(f"- {a}" for a in accepted[:5])
    return "\n".join(lines)


# ── Tolerant parse (module-level so it is unit-testable) ───────────────


def _coerce_questions(content: str, n_candidates: int) -> list[dict[str, Any]]:
    """Parse the model's JSON into at most 3 clean question dicts, ranked.

    Drops items with an out-of-range or missing candidate_index, or an empty
    question. Returns [] on any structural problem rather than raising.
    """
    try:
        parsed = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return []
    raw_items = parsed.get("questions") if isinstance(parsed, dict) else None
    if not isinstance(raw_items, list):
        return []

    cleaned: list[dict[str, Any]] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        try:
            idx = int(raw["candidate_index"])
        except (KeyError, TypeError, ValueError):
            continue
        if not (0 <= idx < n_candidates):
            continue
        question = (raw.get("question") or "").strip()
        if not question:
            continue
        rank = raw.get("rank")
        try:
            rank = int(rank)
        except (TypeError, ValueError):
            rank = 999
        cleaned.append(
            {
                "candidate_index": idx,
                "rank": rank,
                "question": question,
                "question_zh": (raw.get("question_zh") or "").strip() or None,
                "question_en": (raw.get("question_en") or "").strip() or None,
                "drafted_message_zh": (raw.get("drafted_message_zh") or "").strip() or None,
                "drafted_message_en": (raw.get("drafted_message_en") or "").strip() or None,
            }
        )

    # One question per candidate (keep the best-ranked), then top 3 by rank.
    best_by_idx: dict[int, dict[str, Any]] = {}
    for item in sorted(cleaned, key=lambda x: x["rank"]):
        best_by_idx.setdefault(item["candidate_index"], item)
    ordered = sorted(best_by_idx.values(), key=lambda x: x["rank"])
    return ordered[:3]


# ── Orchestration ──────────────────────────────────────────────────────


def _render_candidates(candidates: list[_Candidate], owner_names: dict[str, str]) -> str:
    blocks: list[str] = []
    for i, c in enumerate(candidates):
        owner = owner_names.get(str(c.owner_id), "unassigned") if c.owner_id else "unassigned"
        if c.kind == "task":
            downstream = ", ".join(c.downstream_titles) or "—"
            blocks.append(
                f"[candidate {i}] (task, blocked) {c.headline} — owner: {owner}\n"
                f"  blocks {c.blast_count} downstream tasks: {downstream}\n"
                f"  context: {c.context[:300]}"
            )
        else:
            blocks.append(
                f"[candidate {i}] (decision, review overdue) {c.headline} — owner: {owner}\n"
                f"  prior answer (may be stale): {c.context[:200]}\n"
                f"  {c.extra}"
            )
    return "\n\n".join(blocks)


async def _owner_names(session: AsyncSession) -> dict[str, str]:
    rows = (
        await session.execute(
            text("select id, coalesce(name, email) from public.users")
        )
    ).all()
    return {str(r[0]): r[1] for r in rows}


async def _project_state_snapshot(session: AsyncSession, project_id: UUID) -> str:
    project = (
        await session.execute(
            text("select name, vision, current_stage from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if project is None:
        return "# Project state snapshot\n(unknown project)\n"
    return (
        "# Project state snapshot\n"
        f"Name: {project[0]}\n"
        f"Vision: {project[1] or '—'}\n"
        f"Current stage: {project[2]}\n"
    )


async def _insert_question(
    session: AsyncSession,
    project_id: UUID,
    cand: _Candidate,
    item: dict[str, Any],
    manager_action_id: UUID,
) -> str | None:
    """Insert one open_question, deduped against the live-source partial-unique
    index. Returns the new id, or None if a live card already exists."""
    # The ON CONFLICT arbiter differs by source kind (two partial-unique indexes).
    if cand.kind == "task":
        conflict = (
            "on conflict (source_task_id) "
            "where source_task_id is not null and status in ('open','routed') do nothing"
        )
    else:
        conflict = (
            "on conflict (source_decision_id) "
            "where source_decision_id is not null and status in ('open','routed') do nothing"
        )
    sql = text(
        f"""
        insert into public.open_questions
          (project_id, question, question_zh, question_en,
           drafted_message_zh, drafted_message_en,
           source_task_id, source_decision_id, target_owner_id,
           blast_radius, status, manager_action_id, embedding)
        values
          (:pid, :q, :qzh, :qen, :mzh, :men,
           :stask, :sdec, :owner,
           cast(:blast as jsonb), 'open', :ma,
           cast(:emb as vector))
        {conflict}
        returning id
        """
    )
    inserted = (
        await session.execute(
            sql,
            {
                "pid": str(project_id),
                "q": item["question"],
                "qzh": item["question_zh"],
                "qen": item["question_en"],
                "mzh": item["drafted_message_zh"],
                "men": item["drafted_message_en"],
                "stask": str(cand.source_id) if cand.kind == "task" else None,
                "sdec": str(cand.source_id) if cand.kind == "decision" else None,
                "owner": str(cand.owner_id) if cand.owner_id else None,
                "blast": json.dumps(cand.blast_radius),
                "ma": str(manager_action_id),
                "emb": str(cand.embedding) if cand.embedding is not None else None,
            },
        )
    ).first()
    return str(inserted[0]) if inserted is not None else None


async def run_derive(
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
) -> dict[str, Any]:
    """Run one derive pass. Returns {question_ids, candidate_count, written, dropped_dup}."""
    await _embed_missing_artifacts(session, project_id, workspace_id)

    candidates = (await _task_candidates(session, project_id)) + (
        await _decision_candidates(session, project_id)
    )
    candidates = candidates[:MAX_CANDIDATES]
    candidate_count = len(candidates)
    if not candidates:
        return {"question_ids": [], "candidate_count": 0, "written": 0, "dropped_dup": 0}

    survivors = await _dedupe(session, project_id, workspace_id, candidates)
    dropped_dup = candidate_count - len(survivors)
    if not survivors:
        return {
            "question_ids": [],
            "candidate_count": candidate_count,
            "written": 0,
            "dropped_dup": dropped_dup,
        }

    owner_names = await _owner_names(session)
    user_query = "## Candidate blocking unknowns\n" + _render_candidates(survivors, owner_names)
    stable_system = load_prompt("open_question_system")
    project_state = await _project_state_snapshot(session, project_id)
    feedback_block = await _build_feedback_block(session, project_id)

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state + feedback_block,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="open_question",
        messages=messages,
        session=session,
        project_id=project_id,
        workspace_id=workspace_id,
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=3072,
        audit_input={
            "candidate_count": candidate_count,
            "task_cands": sum(1 for c in survivors if c.kind == "task"),
            "decision_cands": sum(1 for c in survivors if c.kind == "decision"),
        },
    )

    action_row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = :pid and action_type = 'open_question'
                order by created_at desc limit 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()
    if action_row is None:
        return {
            "question_ids": [],
            "candidate_count": candidate_count,
            "written": 0,
            "dropped_dup": dropped_dup,
        }
    manager_action_id = UUID(str(action_row[0]))

    question_ids: list[str] = []
    for item in _coerce_questions(content, len(survivors)):
        cand = survivors[item["candidate_index"]]
        new_id = await _insert_question(session, project_id, cand, item, manager_action_id)
        if new_id is not None:
            question_ids.append(new_id)

    return {
        "question_ids": question_ids,
        "candidate_count": candidate_count,
        "written": len(question_ids),
        "dropped_dup": dropped_dup,
    }
