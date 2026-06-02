"""Weekly Backlog Optimizer endpoints (M7).

POST /api/projects/{id}/optimizer/run        — runs a review, persists to manager_actions.
POST /api/projects/{id}/optimizer/decisions  — applies reviewed reorders/drops/adds and
                                              writes structured feedback.

Same feedback-loop pattern as M5 generate.py:
  1. Prompt includes recent `manager_actions` rows with action_type='backlog_optimizer'
     so the next run learns from prior accept/reject outcomes.
  2. Each individual reorder / drop / add suggestion is reviewed accept|edit|reject;
     outcomes go to manager_actions.human_feedback as structured JSON.
"""

from __future__ import annotations

import json
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

router = APIRouter(tags=["ai"], prefix="/api/projects")


# ── Request / response shapes ─────────────────────────────────────────


class ReorderItem(BaseModel):
    task_id: UUID
    new_priority: int
    reasoning: str | None = None


class DropItem(BaseModel):
    task_id: UUID
    reason: str | None = None


class AddItem(BaseModel):
    title: str
    description: str | None = None
    estimated_hours: float | None = None
    reasoning: str | None = None
    gap_filled: str | None = None


class RiskItem(BaseModel):
    severity: str = "medium"  # medium | high | critical
    source_type: str | None = None  # artifact | decision | task | external | other
    source_label: str | None = None
    title: str
    description: str | None = None
    implications: str | None = None


class OptimizerReview(BaseModel):
    risks: list[RiskItem] = Field(default_factory=list)
    reorder: list[ReorderItem] = Field(default_factory=list)
    drops: list[DropItem] = Field(default_factory=list)
    adds: list[AddItem] = Field(default_factory=list)
    critical_path: list[UUID] = Field(default_factory=list)
    unknowns: list[str] = Field(default_factory=list)
    overall_reasoning: str | None = None


class RunOptimizerOut(BaseModel):
    manager_action_id: UUID
    review: OptimizerReview


class OptimizerDecision(BaseModel):
    """One per suggestion. `kind` and `target_index` identify which item in the original review."""

    kind: str  # "reorder" | "drop" | "add"
    target_index: int
    action: str  # "accept" | "edit" | "reject"
    edit: dict[str, Any] | None = None
    reject_reason_chip: str | None = None
    reject_reason_free: str | None = None


class SubmitDecisionsIn(BaseModel):
    manager_action_id: UUID
    decisions: list[OptimizerDecision]


class SubmitDecisionsOut(BaseModel):
    summary: dict[str, int]
    applied: dict[str, int]


# ── Helpers ───────────────────────────────────────────────────────────


async def _load_project_workspace(
    session: AsyncSession, project_id: UUID
) -> UUID:
    """Post-M13: any authed user can act on any project. Return the
    project's workspace_id so LLM budget enforcement applies to the
    correct daily cap."""
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
    """Optimizer needs the full active backlog with UUIDs so the model can
    refer to tasks by id. Plus aggregate completed-vs-estimated for calibration."""
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

    active_tasks = (
        await session.execute(
            text(
                """
                select t.id, t.title, t.status, t.priority, t.estimated_hours,
                       t.actual_hours, coalesce(u.name, u.email) as owner,
                       t.description
                from public.tasks t
                left join public.users u on t.owner_id = u.id
                where t.project_id = :pid
                  and t.status in ('backlog','ready','in_progress','blocked')
                order by t.priority desc, t.created_at desc
                limit 80
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    # How many active tasks exist in total, so we can tell the model (and the
    # user, via the snapshot) when the backlog was truncated to the top 80
    # rather than silently advising on a partial picture.
    total_active = (
        await session.execute(
            text(
                """
                select count(*) from public.tasks
                where project_id = :pid
                  and status in ('backlog','ready','in_progress','blocked')
                """
            ),
            {"pid": str(project_id)},
        )
    ).scalar_one()

    completed_summary = (
        await session.execute(
            text(
                """
                select coalesce(sum(estimated_hours), 0) as est,
                       coalesce(sum(actual_hours), 0) as act,
                       count(*) as n
                from public.tasks
                where project_id = :pid
                  and status = 'done'
                  and completed_at > now() - interval '4 weeks'
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()

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

    recent_artifacts = (
        await session.execute(
            text(
                """
                select title, type, created_at,
                       coalesce(content, '') as content
                from public.artifacts
                where project_id = :pid
                order by created_at desc
                limit 12
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
        "## Completion calibration (last 4 weeks)",
    ]
    if completed_summary and completed_summary[2]:
        est = float(completed_summary[0] or 0)
        act = float(completed_summary[1] or 0)
        ratio = f"{(act / est):.2f}" if est > 0 else "—"
        lines.append(
            f"- {completed_summary[2]} tasks done, est={est}h, actual={act}h, "
            f"actual/est ratio={ratio}"
        )
    else:
        lines.append("- (no recent completions)")

    lines.append("")
    lines.append("## Active tasks")
    if total_active > len(active_tasks):
        lines.append(
            f"> Showing the top {len(active_tasks)} of {total_active} active tasks "
            "(truncated by priority). Recommendations cover only the tasks listed below."
        )
    lines.append(
        "Format: `<task_id> | [status] title (owner, priority, est_hours)`. "
        "Use the literal UUID when referring to tasks in your output."
    )
    if active_tasks:
        for t in active_tasks:
            desc = (t[7] or "").strip().replace("\n", " ")
            if len(desc) > 120:
                desc = desc[:120] + "…"
            lines.append(
                f"- `{t[0]}` | [{t[2]}] {t[1]} "
                f"(owner: {t[6] or '—'}, priority: {t[3]}, est: {t[4] or '—'}h)"
                + (f"\n    desc: {desc}" if desc else "")
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

    lines.append("")
    lines.append("## Recent artifacts (with content for risk scanning)")
    if recent_artifacts:
        for a in recent_artifacts:
            content = (a[3] or "").strip()
            content_excerpt = content[:1200] + ("…" if len(content) > 1200 else "")
            lines.append(f"### [{a[1]}] {a[0]} · {a[2].date().isoformat()}")
            if content_excerpt:
                lines.append(content_excerpt)
            else:
                lines.append("(no content)")
    else:
        lines.append("- (none)")

    return "\n".join(lines)


async def _build_feedback_block(session: AsyncSession, project_id: UUID) -> str:
    """Past-reviews block — pulls last 8 backlog_optimizer manager_actions with feedback."""
    rows = await llm.recent_feedback(
        session, project_id, action_type="backlog_optimizer", limit=8
    )
    if not rows:
        return ""

    lines = ["", "## Past feedback on your backlog reviews"]
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
            content = out["content"]
            lines.append(content[:1500] + ("…" if len(content) > 1500 else ""))
        if feedback:
            lines.append(f"Human feedback: {feedback[:1500]}")
    return "\n".join(lines)


# ── Internal entry point reused by the scheduler ──────────────────────


async def run_optimizer_for_project(
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
) -> tuple[UUID, OptimizerReview]:
    """Single LLM round-trip (loop cap ≤3 — design rule #3, here ==1)."""
    stable_system = load_prompt("backlog_optimizer_system")
    project_state = await _build_project_state(session, project_id)
    feedback_block = await _build_feedback_block(session, project_id)

    user_query = (
        "请扫描以上 backlog，输出本周的 reorder / drops / adds / critical_path / unknowns。"
        "如果 backlog 已经合理，相关数组返回空 `[]` 也可以。严格 JSON。"
    )
    dynamic_state = project_state + feedback_block

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=dynamic_state,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="backlog_optimizer",
        messages=messages,
        session=session,
        project_id=project_id,
        workspace_id=workspace_id,
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=4096,
        audit_input={"trigger": "manual_or_cron"},
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model returned non-JSON: {exc}",
        ) from exc

    review = _coerce_review(parsed)

    action_row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = :pid and action_type = 'backlog_optimizer'
                order by created_at desc limit 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()
    if action_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record the optimizer action.",
        )
    return UUID(str(action_row[0])), review


def _coerce_review(parsed: dict[str, Any]) -> OptimizerReview:
    """Tolerant parse — drop malformed items rather than 500'ing the whole run."""
    reorder: list[ReorderItem] = []
    for r in parsed.get("reorder", []) or []:
        try:
            reorder.append(
                ReorderItem(
                    task_id=UUID(str(r["task_id"])),
                    new_priority=int(r["new_priority"]),
                    reasoning=r.get("reasoning"),
                )
            )
        except (KeyError, ValueError, TypeError):
            continue

    drops: list[DropItem] = []
    for d in parsed.get("drops", []) or []:
        try:
            drops.append(DropItem(task_id=UUID(str(d["task_id"])), reason=d.get("reason")))
        except (KeyError, ValueError, TypeError):
            continue

    adds: list[AddItem] = []
    for a in parsed.get("adds", []) or []:
        if not a.get("title"):
            continue
        adds.append(
            AddItem(
                title=str(a["title"]),
                description=a.get("description"),
                estimated_hours=a.get("estimated_hours"),
                reasoning=a.get("reasoning"),
                gap_filled=a.get("gap_filled"),
            )
        )

    critical_path: list[UUID] = []
    for tid in parsed.get("critical_path", []) or []:
        try:
            critical_path.append(UUID(str(tid)))
        except (ValueError, TypeError):
            continue

    unknowns = [str(u) for u in (parsed.get("unknowns", []) or []) if u]

    risks: list[RiskItem] = []
    valid_sev = {"medium", "high", "critical"}
    for r in parsed.get("risks", []) or []:
        title = r.get("title")
        if not title:
            continue
        sev = str(r.get("severity") or "medium").lower()
        if sev not in valid_sev:
            sev = "medium"
        risks.append(
            RiskItem(
                severity=sev,
                source_type=r.get("source_type"),
                source_label=r.get("source_label"),
                title=str(title),
                description=r.get("description"),
                implications=r.get("implications"),
            )
        )

    return OptimizerReview(
        risks=risks,
        reorder=reorder,
        drops=drops,
        adds=adds,
        critical_path=critical_path,
        unknowns=unknowns,
        overall_reasoning=parsed.get("overall_reasoning"),
    )


# ── POST /api/projects/{project_id}/optimizer/run ─────────────────────


class RunOptimizerIn(BaseModel):
    pass  # Empty body — kept as a class so OpenAPI shape stays explicit.


@router.post("/{project_id}/optimizer/run", response_model=RunOptimizerOut)
async def run_optimizer(
    project_id: UUID,
    _body: RunOptimizerIn | None = None,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> RunOptimizerOut:
    project_workspace_id = await _load_project_workspace(session, project_id)
    action_id, review = await run_optimizer_for_project(
        session, project_id, project_workspace_id
    )
    return RunOptimizerOut(manager_action_id=action_id, review=review)


# ── POST /api/projects/{project_id}/optimizer/decisions ───────────────


@router.post("/{project_id}/optimizer/decisions", response_model=SubmitDecisionsOut)
async def submit_optimizer_decisions(
    project_id: UUID,
    body: SubmitDecisionsIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> SubmitDecisionsOut:
    await _load_project_workspace(session, project_id)

    action = (
        await session.execute(
            text(
                """
                select output from public.manager_actions
                where id = :aid and project_id = :pid
                  and action_type = 'backlog_optimizer'
                """
            ),
            {"aid": str(body.manager_action_id), "pid": str(project_id)},
        )
    ).first()
    if action is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="manager_action not found."
        )

    # output is jsonb -> dict with {"content": "<json string>"}
    raw_output = action[0] if isinstance(action[0], dict) else {}
    content_str = raw_output.get("content") if isinstance(raw_output, dict) else None
    try:
        original = json.loads(content_str) if isinstance(content_str, str) else {}
    except json.JSONDecodeError:
        original = {}

    original_reorder = original.get("reorder", []) or []
    original_drops = original.get("drops", []) or []
    original_adds = original.get("adds", []) or []

    summary = {"accepted": 0, "edited": 0, "rejected": 0}
    applied = {"reorders": 0, "drops": 0, "adds": 0}
    feedback_records: list[dict[str, Any]] = []

    for decision in body.decisions:
        bucket = (
            original_reorder
            if decision.kind == "reorder"
            else original_drops
            if decision.kind == "drop"
            else original_adds
            if decision.kind == "add"
            else None
        )
        if bucket is None or not (0 <= decision.target_index < len(bucket)):
            continue
        proposal = bucket[decision.target_index]

        if decision.action == "reject":
            summary["rejected"] += 1
            feedback_records.append(
                {
                    "kind": decision.kind,
                    "target_index": decision.target_index,
                    "proposal": proposal,
                    "action": "reject",
                    "reason_chip": decision.reject_reason_chip,
                    "reason_free": decision.reject_reason_free,
                }
            )
            continue

        # accept or edit → apply the mutation
        edited = decision.edit or {}
        if decision.kind == "reorder":
            task_id = edited.get("task_id") or proposal.get("task_id")
            new_priority = edited.get("new_priority", proposal.get("new_priority"))
            if task_id is not None and new_priority is not None:
                await session.execute(
                    text(
                        """
                        update public.tasks
                          set priority = :p
                        where id = :tid and project_id = :pid
                        """
                    ),
                    {"p": int(new_priority), "tid": str(task_id), "pid": str(project_id)},
                )
                applied["reorders"] += 1

        elif decision.kind == "drop":
            task_id = edited.get("task_id") or proposal.get("task_id")
            if task_id is not None:
                await session.execute(
                    text(
                        """
                        update public.tasks
                          set status = 'dropped'
                        where id = :tid and project_id = :pid
                        """
                    ),
                    {"tid": str(task_id), "pid": str(project_id)},
                )
                applied["drops"] += 1

        elif decision.kind == "add":
            title = edited.get("title") or proposal.get("title")
            if title:
                await session.execute(
                    text(
                        """
                        insert into public.tasks
                          (project_id, title, description, estimated_hours,
                           created_by, status)
                        values (:pid, :title, :desc, :est, 'ai', 'backlog')
                        """
                    ),
                    {
                        "pid": str(project_id),
                        "title": title,
                        "desc": edited.get("description") or proposal.get("description"),
                        "est": edited.get("estimated_hours") or proposal.get("estimated_hours"),
                    },
                )
                applied["adds"] += 1

        if decision.action == "edit":
            summary["edited"] += 1
        else:
            summary["accepted"] += 1

        feedback_records.append(
            {
                "kind": decision.kind,
                "target_index": decision.target_index,
                "action": decision.action,
                "original": proposal,
                "final": edited or proposal,
            }
        )

    total = sum(summary.values())
    overall_accepted = (
        total > 0 and (summary["accepted"] + summary["edited"]) > 0 and summary["rejected"] < total
    )
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
                {"summary": summary, "applied": applied, "decisions": feedback_records},
                ensure_ascii=False,
                default=str,
            ),
            "aid": str(body.manager_action_id),
        },
    )

    return SubmitDecisionsOut(summary=summary, applied=applied)
