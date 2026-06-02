"""Meeting Orchestrator endpoints (M11).

Four endpoints, mirroring the M5 generate/persist shape:

  POST /api/meetings/{mid}/pre_brief             → generate agenda from project state
  POST /api/meetings/{mid}/pre_brief/respond     → accept / edit / reject the agenda
  POST /api/meetings/{mid}/post_summary          → extract action items from notes
  POST /api/meetings/{mid}/post_summary/persist  → apply per-item verdicts → tasks

CRUD on meetings (create / update attendees, notes, scheduled_at) goes through
Supabase JS direct from the frontend — RLS policy on `meetings` enforces
project scoping. The backend only touches meetings for AI-driven flows.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser, current_user
from app.llm import manager as llm
from app.llm.prompts import load as load_prompt

router = APIRouter(tags=["ai"])


# ── Helpers ───────────────────────────────────────────────────────────


async def _load_meeting(
    session: AsyncSession, meeting_id: UUID
) -> dict[str, Any]:
    """Fetch a meeting + its project's workspace_id (for budget enforcement).
    Post-M13: any signed-in caller can act on any meeting."""
    row = (
        await session.execute(
            text(
                """
                select m.id, m.project_id, m.type, m.scheduled_at, m.attendees,
                       m.agenda, m.notes, m.ai_pre_brief, m.ai_post_summary,
                       p.workspace_id
                from public.meetings m
                join public.projects p on m.project_id = p.id
                where m.id = :mid
                """
            ),
            {"mid": str(meeting_id)},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Meeting not found.",
        )
    return {
        "id": UUID(str(row[0])),
        "project_id": UUID(str(row[1])),
        "type": row[2],
        "scheduled_at": row[3],
        "attendees": list(row[4] or []),
        "agenda": row[5],
        "notes": row[6],
        "ai_pre_brief": row[7],
        "ai_post_summary": row[8],
        "project_workspace_id": UUID(str(row[9])),
    }


async def _build_project_state(session: AsyncSession, project_id: UUID) -> str:
    """Trimmed project state snapshot for meeting prompts.

    Smaller than generate.py's version — meetings are about recent activity,
    not the full backlog. Active tasks, last 10 days of decisions, and the
    last meeting's notes (if any).
    """
    project = (
        await session.execute(
            text("select name, vision, current_stage from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    teammates = (
        await session.execute(
            text(
                """
                select u.email, coalesce(u.name, u.email) as name, u.role
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
                select t.title, t.status, t.estimated_hours,
                       coalesce(u.name, u.email) as owner
                from public.tasks t
                left join public.users u on t.owner_id = u.id
                where t.project_id = :pid
                  and t.status in ('ready','in_progress','blocked')
                order by t.priority desc, t.created_at desc
                limit 25
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
                  and decided_at > now() - interval '14 days'
                order by decided_at desc
                limit 8
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    last_meeting = (
        await session.execute(
            text(
                """
                select type, scheduled_at, notes, ai_post_summary
                from public.meetings
                where project_id = :pid
                  and notes is not null
                order by coalesce(scheduled_at, '1970-01-01'::timestamptz) desc
                limit 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()

    lines: list[str] = [
        "# Project state snapshot",
        f"Name: {project[0]}",
        f"Vision: {project[1] or '—'}",
        f"Current stage: {project[2]}",
        "",
        "## Teammates",
    ]
    for tm in teammates:
        lines.append(f"- {tm[1]} <{tm[0]}> ({tm[2]})")

    lines.append("")
    lines.append("## Active tasks")
    if active_tasks:
        for t in active_tasks:
            lines.append(
                f"- [{t[1]}] {t[0]} (owner: {t[3] or '—'}, est: {t[2] or '—'}h)"
            )
    else:
        lines.append("- (none)")

    lines.append("")
    lines.append("## Recent decisions (last 14 days)")
    if recent_decisions:
        for d in recent_decisions:
            lines.append(f"- {d[2].date().isoformat()}: {d[0]} — {d[1] or 'no reasoning'}")
    else:
        lines.append("- (none)")

    if last_meeting is not None:
        lines.append("")
        lines.append("## Last meeting context")
        lines.append(f"- Type: {last_meeting[0]}")
        if last_meeting[1]:
            lines.append(f"- Date: {last_meeting[1].date().isoformat()}")
        if last_meeting[3]:
            lines.append(f"- Summary: {last_meeting[3]}")
        if last_meeting[2]:
            excerpt = last_meeting[2][:1500] + ("…" if len(last_meeting[2]) > 1500 else "")
            lines.append(f"- Notes excerpt:\n{excerpt}")

    return "\n".join(lines)


async def _build_feedback_block(
    session: AsyncSession, project_id: UUID, action_type: str
) -> str:
    rows = await llm.recent_feedback(session, project_id, action_type, limit=10)  # type: ignore[arg-type]
    if not rows:
        return ""
    label = (
        "Past feedback on your meeting pre-briefs"
        if action_type == "meeting_pre_brief"
        else "Past feedback on your action item extraction"
    )
    lines = ["", f"## {label}"]
    for r in rows:
        feedback = r.get("human_feedback") or ""
        accepted = r.get("accepted_by_human")
        verdict = (
            "ACCEPTED"
            if accepted is True
            else "REJECTED"
            if accepted is False
            else "PARTIAL"
        )
        lines.append(f"### [{verdict}] {r.get('created_at')}")
        if feedback:
            lines.append(feedback[:1500])
    return "\n".join(lines)


async def _latest_action_id(
    session: AsyncSession, project_id: UUID, action_type: str
) -> UUID:
    row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = :pid and action_type = :atype
                order by created_at desc limit 1
                """
            ),
            {"pid": str(project_id), "atype": action_type},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to locate the recorded manager action.",
        )
    return UUID(str(row[0]))


# ── /pre_brief ────────────────────────────────────────────────────────


class PreBriefOut(BaseModel):
    manager_action_id: UUID
    markdown: str


@router.post("/api/meetings/{meeting_id}/pre_brief", response_model=PreBriefOut)
async def generate_pre_brief(
    meeting_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PreBriefOut:

    meeting = await _load_meeting(session, meeting_id)

    stable_system = load_prompt("meeting_pre_brief_system")
    project_state = await _build_project_state(session, meeting["project_id"])
    feedback_block = await _build_feedback_block(
        session, meeting["project_id"], "meeting_pre_brief"
    )

    scheduled = (
        meeting["scheduled_at"].isoformat() if meeting["scheduled_at"] else "TBD"
    )
    user_query = (
        f"## This meeting\n"
        f"Type: {meeting['type']}\n"
        f"Scheduled: {scheduled}\n"
        f"Attendee count: {len(meeting['attendees'])}\n\n"
        f"请基于上面的 project state 起草这次 meeting 的 pre-brief markdown。"
    )

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state + feedback_block,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="meeting_pre_brief",
        messages=messages,
        session=session,
        project_id=meeting["project_id"],
        workspace_id=meeting["project_workspace_id"],
        temperature=0.3,
        max_tokens=2048,
        audit_input={"meeting_id": str(meeting_id), "meeting_type": meeting["type"]},
    )

    await session.execute(
        text("update public.meetings set ai_pre_brief = :md where id = :mid"),
        {"md": content, "mid": str(meeting_id)},
    )

    action_id = await _latest_action_id(
        session, meeting["project_id"], "meeting_pre_brief"
    )
    return PreBriefOut(manager_action_id=action_id, markdown=content)


class PreBriefRespondIn(BaseModel):
    action: str  # "accept" | "edit" | "reject"
    edited_markdown: str | None = None
    reason: str | None = None


class PreBriefRespondOut(BaseModel):
    final_markdown: str | None


@router.post(
    "/api/meetings/{meeting_id}/pre_brief/respond",
    response_model=PreBriefRespondOut,
)
async def respond_pre_brief(
    meeting_id: UUID,
    body: PreBriefRespondIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PreBriefRespondOut:

    meeting = await _load_meeting(session, meeting_id)

    if body.action not in ("accept", "edit", "reject"):
        raise HTTPException(status_code=400, detail="action must be accept|edit|reject")
    if body.action == "edit" and not (body.edited_markdown or "").strip():
        raise HTTPException(status_code=400, detail="edit requires edited_markdown")
    if body.action == "reject" and not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="reject requires a reason")

    action_id = await _latest_action_id(
        session, meeting["project_id"], "meeting_pre_brief"
    )

    final_markdown: str | None = None
    if body.action == "accept":
        final_markdown = meeting["ai_pre_brief"]
    elif body.action == "edit":
        final_markdown = body.edited_markdown

    if final_markdown is not None:
        await session.execute(
            text(
                """
                update public.meetings
                  set agenda = jsonb_set(
                    coalesce(agenda, cast('{}' as jsonb)),
                    '{markdown}',
                    to_jsonb(cast(:md as text))
                  )
                  where id = :mid
                """
            ),
            {"md": final_markdown, "mid": str(meeting_id)},
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
            "acc": body.action in ("accept", "edit"),
            "fb": json.dumps(
                {
                    "action": body.action,
                    "final_markdown": final_markdown,
                    "reason": body.reason,
                },
                ensure_ascii=False,
            ),
            "aid": str(action_id),
        },
    )

    return PreBriefRespondOut(final_markdown=final_markdown)


# ── /post_summary ─────────────────────────────────────────────────────


class ActionItemProposal(BaseModel):
    index: int
    title: str
    description: str | None = None
    suggested_owner_email: str | None = None
    estimated_hours: float | None = None
    reasoning: str | None = None


class PostSummaryOut(BaseModel):
    manager_action_id: UUID
    summary: str
    action_items: list[ActionItemProposal]


@router.post(
    "/api/meetings/{meeting_id}/post_summary", response_model=PostSummaryOut
)
async def extract_post_summary(
    meeting_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PostSummaryOut:

    meeting = await _load_meeting(session, meeting_id)

    if not (meeting["notes"] or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Meeting has no notes yet — record notes first.",
        )

    stable_system = load_prompt("meeting_post_summary_system")
    project_state = await _build_project_state(session, meeting["project_id"])
    feedback_block = await _build_feedback_block(
        session, meeting["project_id"], "meeting_post_summary"
    )

    user_query = (
        f"## This meeting\n"
        f"Type: {meeting['type']}\n"
        f"## Notes\n{meeting['notes']}"
    )

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state + feedback_block,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="meeting_post_summary",
        messages=messages,
        session=session,
        project_id=meeting["project_id"],
        workspace_id=meeting["project_workspace_id"],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=2048,
        audit_input={
            "meeting_id": str(meeting_id),
            "notes_len": len(meeting["notes"] or ""),
        },
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model returned non-JSON: {exc}",
        ) from exc

    summary = parsed.get("summary") or ""
    raw_items = parsed.get("action_items") or []
    proposals = [
        ActionItemProposal(
            index=i,
            title=it.get("title", "(untitled)"),
            description=it.get("description"),
            suggested_owner_email=it.get("suggested_owner_email"),
            estimated_hours=it.get("estimated_hours"),
            reasoning=it.get("reasoning"),
        )
        for i, it in enumerate(raw_items)
    ]

    action_id = await _latest_action_id(
        session, meeting["project_id"], "meeting_post_summary"
    )
    return PostSummaryOut(
        manager_action_id=action_id, summary=summary, action_items=proposals
    )


class ActionItemDecision(BaseModel):
    index: int
    action: str  # "accept" | "edit" | "reject"
    title: str | None = None
    description: str | None = None
    estimated_hours: float | None = None
    suggested_owner_id: UUID | None = None
    reject_reason_chip: str | None = None
    reject_reason_free: str | None = None


class PersistActionItemsIn(BaseModel):
    manager_action_id: UUID
    decisions: list[ActionItemDecision]


class PersistActionItemsOut(BaseModel):
    persisted_task_ids: list[UUID]
    summary: dict[str, int]


@router.post(
    "/api/meetings/{meeting_id}/post_summary/persist",
    response_model=PersistActionItemsOut,
)
async def persist_post_summary(
    meeting_id: UUID,
    body: PersistActionItemsIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> PersistActionItemsOut:

    meeting = await _load_meeting(session, meeting_id)

    action = (
        await session.execute(
            text(
                """
                select output from public.manager_actions
                where id = :aid and project_id = :pid
                  and action_type = 'meeting_post_summary'
                """
            ),
            {"aid": str(body.manager_action_id), "pid": str(meeting["project_id"])},
        )
    ).first()
    if action is None:
        raise HTTPException(status_code=404, detail="manager_action not found.")

    try:
        original = json.loads(action[0]["content"]) if isinstance(action[0], dict) else {}
    except Exception:
        original = {}
    original_items: list[dict[str, Any]] = original.get("action_items") or []

    persisted_ids: list[UUID] = []
    summary_counts = {"accepted": 0, "edited": 0, "rejected": 0}
    feedback_records: list[dict[str, Any]] = []

    for decision in body.decisions:
        item = (
            original_items[decision.index]
            if 0 <= decision.index < len(original_items)
            else None
        )
        if item is None:
            continue

        if decision.action == "reject":
            summary_counts["rejected"] += 1
            feedback_records.append(
                {
                    "index": decision.index,
                    "proposed_title": item.get("title"),
                    "action": "reject",
                    "reason_chip": decision.reject_reason_chip,
                    "reason_free": decision.reject_reason_free,
                }
            )
            continue

        title = (
            decision.title
            if decision.action == "edit" and decision.title
            else item.get("title", "(untitled)")
        )
        description = (
            decision.description
            if decision.action == "edit" and decision.description is not None
            else item.get("description")
        )
        estimated_hours = (
            decision.estimated_hours
            if decision.action == "edit" and decision.estimated_hours is not None
            else item.get("estimated_hours")
        )

        new_row = (
            await session.execute(
                text(
                    """
                    insert into public.tasks
                      (project_id, title, description, estimated_hours,
                       owner_id, created_by, status)
                    values (:pid, :title, :desc, :est, :owner, 'ai', 'backlog')
                    returning id
                    """
                ),
                {
                    "pid": str(meeting["project_id"]),
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
                detail="Failed to insert action item.",
            )
        new_id = UUID(str(new_row[0]))
        persisted_ids.append(new_id)

        if decision.action == "edit":
            summary_counts["edited"] += 1
        else:
            summary_counts["accepted"] += 1

        feedback_records.append(
            {
                "index": decision.index,
                "task_id": str(new_id),
                "action": decision.action,
                "original": {
                    "title": item.get("title"),
                    "description": item.get("description"),
                    "estimated_hours": item.get("estimated_hours"),
                },
                "final": {
                    "title": title,
                    "description": description,
                    "estimated_hours": estimated_hours,
                },
            }
        )

    overall_accepted = (summary_counts["accepted"] + summary_counts["edited"]) > 0
    tally = (
        f"{summary_counts['accepted']} accepted, "
        f"{summary_counts['edited']} edited, "
        f"{summary_counts['rejected']} rejected"
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
                {"summary": summary_counts, "decisions": feedback_records},
                ensure_ascii=False,
            ),
            "aid": str(body.manager_action_id),
        },
    )

    # Short tally on the meeting itself for the dashboard.
    await session.execute(
        text("update public.meetings set ai_post_summary = :s where id = :mid"),
        {"s": tally, "mid": str(meeting_id)},
    )

    return PersistActionItemsOut(
        persisted_task_ids=persisted_ids, summary=summary_counts
    )
