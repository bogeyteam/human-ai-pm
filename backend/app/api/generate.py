"""Task Generator endpoint (M5).

POST /api/projects/{id}/generate_tasks — proposes tasks from a brainstorm.
POST /api/projects/{id}/persist_tasks  — persists user-reviewed proposals
                                         and writes structured feedback.

Both endpoints implement the design rule #2 feedback loop:
  1. Prompt for generation includes recent `manager_actions` rows with
     human feedback (positive + negative signal).
  2. After the user reviews, structured outcomes (accept / edit / reject
     with reason chip) are persisted to `manager_actions.human_feedback`.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser, current_user
from app.llm import manager as llm
from app.llm.prompts import load as load_prompt

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ai"], prefix="/api/projects")


# ── Request / response shapes ─────────────────────────────────────────


class GenerateTasksIn(BaseModel):
    brainstorm: str = Field(..., min_length=10, max_length=20_000)
    artifact_ids: list[UUID] = Field(default_factory=list)


class TaskProposal(BaseModel):
    index: int
    title: str
    description: str | None = None
    estimated_hours: float | None = None
    is_critical_path: bool = False
    stage_alignment: str = "necessary"
    suggested_owner_email: str | None = None
    dependencies: list[int] = Field(default_factory=list)
    reasoning: str | None = None
    updates_task_id: UUID | None = None
    updates_task_title: str | None = None  # populated by backend for diff display


class GenerateTasksOut(BaseModel):
    manager_action_id: UUID
    proposals: list[TaskProposal]
    overall_reasoning: str | None = None


class PersistDecision(BaseModel):
    """One per proposed task. The user verdict + optional edit + optional reason."""

    index: int
    action: str  # "accept" | "edit" | "reject"
    # Edited fields (only used when action == "edit"):
    title: str | None = None
    description: str | None = None
    estimated_hours: float | None = None
    suggested_owner_id: UUID | None = None
    # Only used when action == "reject":
    reject_reason_chip: str | None = None
    reject_reason_free: str | None = None
    # Set when the proposal updates an existing task rather than creating one:
    updates_task_id: UUID | None = None


class PersistTasksIn(BaseModel):
    manager_action_id: UUID
    decisions: list[PersistDecision]


class PersistTasksOut(BaseModel):
    persisted_task_ids: list[UUID]
    summary: dict[str, int]


# ── Helpers ───────────────────────────────────────────────────────────


async def _load_project_workspace(
    session: AsyncSession, project_id: UUID
) -> UUID:
    """Confirm the project exists and return its workspace_id.

    Post-M13 (workspace boundaries open to all signed-in users): any
    authenticated caller can act on any project. We still need the
    project's workspace_id so the LLM budget check applies to the right
    workspace's daily cap.
    """
    row = (
        await session.execute(
            text("select workspace_id from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Project not found.",
        )
    return UUID(str(row[0]))


async def _build_project_state(session: AsyncSession, project_id: UUID) -> str:
    """Project state snapshot — the middle, cacheable segment of the prompt."""
    project = (
        await session.execute(
            text(
                """
                select name, vision, current_stage, preferences
                from public.projects where id = :pid
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    teammates = (
        await session.execute(
            text(
                """
                select u.email, coalesce(u.name, u.email) as name,
                       u.role, u.skills, u.work_style
                from public.users u
                join public.projects p on p.workspace_id = u.workspace_id
                where p.id = :pid
                order by u.role desc, u.name nulls last
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    active_tasks = (
        await session.execute(
            text(
                """
                select t.id, t.title, t.status, t.estimated_hours,
                       coalesce(u.name, u.email) as owner
                from public.tasks t
                left join public.users u on t.owner_id = u.id
                where t.project_id = :pid
                  and t.status in ('backlog','ready','in_progress','blocked')
                order by t.priority desc, t.created_at desc
                limit 40
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    recent_decisions = (
        await session.execute(
            text(
                """
                select decision, reasoning, decided_at
                from public.decisions
                where project_id = :pid
                order by decided_at desc
                limit 10
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    lines = [
        "# Project state snapshot",
        f"Name: {project[0]}",
        f"Vision: {project[1] or '—'}",
        f"Current stage: {project[2]}",
        f"Preferences (U): {project[3]}",
        "",
        "## Teammates",
    ]
    for tm in teammates:
        lines.append(
            f"- {tm[1]} <{tm[0]}> ({tm[2]}): skills={tm[3]}, style={tm[4]}"
        )

    lines.append("")
    lines.append("## Active tasks")
    if active_tasks:
        for t in active_tasks:
            lines.append(
                f"- [id:{t[0]}] [{t[2]}] {t[1]} (owner: {t[4] or '—'}, est: {t[3] or '—'}h)"
            )
    else:
        lines.append("- (none)")

    lines.append("")
    lines.append("## Recent decisions")
    if recent_decisions:
        for d in recent_decisions:
            lines.append(
                f"- {d[2].date().isoformat()}: {d[0]} — {d[1] or 'no reasoning'}"
            )
    else:
        lines.append("- (none)")

    return "\n".join(lines)


async def _build_feedback_block(session: AsyncSession, project_id: UUID) -> str:
    """The feedback-loop section — design rule #2. Pulled from manager_actions."""
    rows = await llm.recent_feedback(
        session, project_id, action_type="task_generation", limit=20
    )
    if not rows:
        return ""

    lines = ["", "## Past feedback on your task suggestions"]
    for r in rows:
        out = r.get("output") or {}
        feedback = r.get("human_feedback")
        accepted = r.get("accepted_by_human")
        verdict = (
            "ACCEPTED"
            if accepted is True
            else "REJECTED"
            if accepted is False
            else "PARTIAL"
        )
        lines.append(f"### [{verdict}] {r.get('created_at')}")
        if isinstance(out, dict) and out.get("content"):
            lines.append(out["content"][:1500])
        if feedback:
            lines.append(f"Human feedback: {feedback[:1500]}")
    return "\n".join(lines)


async def _build_artifacts_block(session: AsyncSession, ids: list[UUID]) -> str:
    if not ids:
        return ""
    rows = (
        await session.execute(
            text(
                """
                select title, type, coalesce(content, '') as content
                from public.artifacts where id = any(cast(:ids as uuid[]))
                """
            ),
            {"ids": [str(i) for i in ids]},
        )
    ).all()
    if not rows:
        return ""
    lines = ["", "## Supporting documents"]
    for r in rows:
        excerpt = r[2][:2000] + ("…" if len(r[2]) > 2000 else "")
        lines.append(f"### {r[0]} ({r[1]})\n{excerpt}")
    return "\n".join(lines)


# ── POST /api/projects/{project_id}/generate_tasks ────────────────────


@router.post("/{project_id}/generate_tasks", response_model=GenerateTasksOut)
async def generate_tasks(
    project_id: UUID,
    body: GenerateTasksIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> GenerateTasksOut:
    project_workspace_id = await _load_project_workspace(session, project_id)

    stable_system = load_prompt("task_generation_system")
    project_state = await _build_project_state(session, project_id)
    feedback_block = await _build_feedback_block(session, project_id)
    artifacts_block = await _build_artifacts_block(session, body.artifact_ids)

    user_query = (
        "## User brainstorm\n"
        f"{body.brainstorm.strip()}\n"
        f"{artifacts_block}"
    )
    # Prepend feedback block to project state so the cache-friendly
    # shape stays [stable_system, dynamic_state_block, user_query].
    dynamic_state = project_state + feedback_block

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=dynamic_state,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="task_generation",
        messages=messages,
        session=session,
        project_id=project_id,
        workspace_id=project_workspace_id,
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=4096,
        audit_input={"brainstorm_len": len(body.brainstorm), "artifact_ids": [str(i) for i in body.artifact_ids]},
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model returned non-JSON: {exc}",
        ) from exc

    raw_tasks = parsed.get("tasks", [])

    # Build a map of valid task IDs for this project so we can validate
    # updates_task_id values the model returns.
    valid_task_rows = (
        await session.execute(
            text(
                "select id, title from public.tasks where project_id = :pid"
                " and status not in ('done','dropped')"
            ),
            {"pid": str(project_id)},
        )
    ).all()
    valid_task_map: dict[str, str] = {str(r[0]): r[1] for r in valid_task_rows}
    proposals: list[TaskProposal] = []
    for i, t in enumerate(raw_tasks):
        raw_uid = t.get("updates_task_id")
        updates_task_id: UUID | None = None
        updates_task_title: str | None = None
        if raw_uid and str(raw_uid) in valid_task_map:
            updates_task_id = UUID(str(raw_uid))
            updates_task_title = valid_task_map[str(raw_uid)]
        proposals.append(
            TaskProposal(
                index=i,
                title=t.get("title", "(untitled)"),
                description=t.get("description"),
                estimated_hours=t.get("estimated_hours"),
                is_critical_path=bool(t.get("is_critical_path", False)),
                stage_alignment=t.get("stage_alignment", "necessary"),
                suggested_owner_email=t.get("suggested_owner_email"),
                dependencies=list(t.get("dependencies", []) or []),
                reasoning=t.get("reasoning"),
                updates_task_id=updates_task_id,
                updates_task_title=updates_task_title,
            )
        )

    # Find the manager_action_id we just wrote so the frontend can
    # reference it on the persist step. Last action of this type for
    # this project, in this DB transaction.
    action_row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = :pid and action_type = 'task_generation'
                order by created_at desc limit 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()
    if action_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record the task-generation action.",
        )

    return GenerateTasksOut(
        manager_action_id=action_row[0],
        proposals=proposals,
        overall_reasoning=parsed.get("overall_reasoning"),
    )


def acyclic_dependency_edges(
    candidate_edges: list[tuple[int, int]],
) -> tuple[list[tuple[int, int]], list[tuple[int, int]]]:
    """Filter candidate task-dependency edges down to an acyclic set.

    Each edge is `(prereq_index, dependent_index)` — the dependent task must
    come *after* its prerequisite. Edges are considered in order; an edge is
    skipped when it is a self-loop or when adding it would close a cycle (the
    dependent already reaches the prereq). Returns `(kept, skipped)`, where
    `kept` is guaranteed to form a DAG.
    """
    adjacency: dict[int, set[int]] = {}
    kept: list[tuple[int, int]] = []
    skipped: list[tuple[int, int]] = []

    def reaches(start: int, target: int) -> bool:
        seen: set[int] = set()
        stack = [start]
        while stack:
            node = stack.pop()
            if node == target:
                return True
            if node in seen:
                continue
            seen.add(node)
            stack.extend(adjacency.get(node, ()))
        return False

    for prereq, dependent in candidate_edges:
        if prereq == dependent or reaches(dependent, prereq):
            skipped.append((prereq, dependent))
            continue
        adjacency.setdefault(prereq, set()).add(dependent)
        kept.append((prereq, dependent))
    return kept, skipped


# ── POST /api/projects/{project_id}/persist_tasks ─────────────────────


@router.post("/{project_id}/persist_tasks", response_model=PersistTasksOut)
async def persist_tasks(
    project_id: UUID,
    body: PersistTasksIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PersistTasksOut:
    await _load_project_workspace(session, project_id)

    # Pull the prior proposals from manager_actions.output.content (JSON string).
    action = (
        await session.execute(
            text(
                """
                select output from public.manager_actions
                where id = :aid and project_id = :pid and action_type = 'task_generation'
                """
            ),
            {"aid": str(body.manager_action_id), "pid": str(project_id)},
        )
    ).first()
    if action is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="manager_action not found.")

    try:
        original = json.loads(action[0]["content"]) if isinstance(action[0], dict) else json.loads(json.loads(action[0]).get("content", "{}"))
    except Exception:
        # action[0] is jsonb decoded as dict; if "content" is a string, parse again.
        original = action[0] if isinstance(action[0], dict) else {}
        if isinstance(original.get("content"), str):
            try:
                original = json.loads(original["content"])
            except Exception:
                original = {}

    original_tasks: list[dict[str, Any]] = original.get("tasks") or []

    persisted_ids: list[UUID] = []
    summary = {"accepted": 0, "edited": 0, "rejected": 0}
    feedback_records: list[dict[str, Any]] = []

    # Index → newly-inserted task ID, so dependencies (using original indices)
    # can be remapped to real task IDs.
    index_to_task_id: dict[int, UUID] = {}

    # First pass: insert accepted / edited tasks.
    for decision in body.decisions:
        proposal = original_tasks[decision.index] if 0 <= decision.index < len(original_tasks) else None
        if proposal is None:
            continue

        if decision.action == "reject":
            summary["rejected"] += 1
            feedback_records.append(
                {
                    "index": decision.index,
                    "proposed_title": proposal.get("title"),
                    "action": "reject",
                    "reason_chip": decision.reject_reason_chip,
                    "reason_free": decision.reject_reason_free,
                }
            )
            continue

        title = decision.title if decision.action == "edit" and decision.title else proposal.get("title", "(untitled)")
        description = (
            decision.description
            if decision.action == "edit" and decision.description is not None
            else proposal.get("description")
        )
        estimated_hours = (
            decision.estimated_hours
            if decision.action == "edit" and decision.estimated_hours is not None
            else proposal.get("estimated_hours")
        )

        # UPDATE path — proposal amends an existing task.
        if decision.updates_task_id is not None:
            await session.execute(
                text(
                    """
                    update public.tasks
                       set title = :title,
                           description = coalesce(:desc, description),
                           estimated_hours = coalesce(cast(:est as float), estimated_hours)
                     where id = :tid and project_id = :pid
                    """
                ),
                {
                    "title": title,
                    "desc": description,
                    "est": estimated_hours,
                    "tid": str(decision.updates_task_id),
                    "pid": str(project_id),
                },
            )
            task_id = decision.updates_task_id
            index_to_task_id[decision.index] = task_id
            persisted_ids.append(task_id)
            if decision.action == "edit":
                summary["edited"] += 1
            else:
                summary["accepted"] += 1
            feedback_records.append(
                {
                    "index": decision.index,
                    "task_id": str(task_id),
                    "action": f"update_{decision.action}",
                    "updates_task_id": str(decision.updates_task_id),
                    "final": {"title": title, "description": description, "estimated_hours": estimated_hours},
                }
            )
            continue

        # INSERT path — new task.
        new_row = (
            await session.execute(
                text(
                    """
                    insert into public.tasks
                      (project_id, title, description, estimated_hours, owner_id, created_by, status)
                    values (:pid, :title, :desc, :est, :owner, 'ai', 'backlog')
                    returning id
                    """
                ),
                {
                    "pid": str(project_id),
                    "title": title,
                    "desc": description,
                    "est": estimated_hours,
                    "owner": str(decision.suggested_owner_id) if decision.suggested_owner_id else None,
                },
            )
        ).first()
        if new_row is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to insert task.",
            )
        new_id = UUID(str(new_row[0]))
        index_to_task_id[decision.index] = new_id
        persisted_ids.append(new_id)

        if decision.action == "edit":
            summary["edited"] += 1
        else:
            summary["accepted"] += 1

        feedback_records.append(
            {
                "index": decision.index,
                "task_id": str(new_id),
                "action": decision.action,
                "original": {
                    "title": proposal.get("title"),
                    "description": proposal.get("description"),
                    "estimated_hours": proposal.get("estimated_hours"),
                },
                "final": {"title": title, "description": description, "estimated_hours": estimated_hours},
            }
        )

    # Second pass: wire up dependencies among accepted tasks, skipping any
    # edge that would introduce a cycle. The LLM can propose A→B→A; the DB
    # would happily store it and downstream DAG traversal (optimizer, kanban
    # ordering) would then loop. We resolve cycles on the index graph before
    # touching the DB (see acyclic_dependency_edges).
    candidate_edges: list[tuple[int, int]] = []
    for decision in body.decisions:
        if decision.action == "reject" or decision.index not in index_to_task_id:
            continue
        proposal = original_tasks[decision.index]
        for raw_prereq in proposal.get("dependencies", []) or []:
            prereq_index = int(raw_prereq)
            if prereq_index in index_to_task_id:
                candidate_edges.append((prereq_index, decision.index))

    kept_edges, skipped_cycle_edges = acyclic_dependency_edges(candidate_edges)
    for prereq_index, dependent_index in kept_edges:
        await session.execute(
            text(
                """
                insert into public.task_dependencies (prereq_task_id, dependent_task_id)
                values (:prereq, :dep)
                on conflict do nothing
                """
            ),
            {
                "prereq": str(index_to_task_id[prereq_index]),
                "dep": str(index_to_task_id[dependent_index]),
            },
        )

    if skipped_cycle_edges:
        logger.warning(
            "persist_tasks skipped %d cycle-forming dependency edge(s) for project %s",
            len(skipped_cycle_edges),
            project_id,
        )

    # Finally: record the structured feedback on the manager_action row.
    accepted_or_edited = summary["accepted"] + summary["edited"]
    total = sum(summary.values())
    overall_accepted = total > 0 and accepted_or_edited > 0 and summary["rejected"] < total
    await session.execute(
        text(
            """
            update public.manager_actions
              set accepted_by_human = :acc,
                  human_feedback = cast(:fb as text)
              where id = :aid
            """
        ),
        {
            "acc": overall_accepted,
            "fb": json.dumps(
                {"summary": summary, "decisions": feedback_records},
                ensure_ascii=False,
            ),
            "aid": str(body.manager_action_id),
        },
    )

    return PersistTasksOut(persisted_task_ids=persisted_ids, summary=summary)
