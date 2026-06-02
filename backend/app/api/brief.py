"""Manager Daily Brief endpoint (M21).

POST /api/projects/{id}/daily_brief          — synthesize a cross-feature
                                                "what needs attention today" digest.
POST /api/projects/{id}/daily_brief/feedback — record a useful/not-useful verdict
                                                so the feedback loop (design rule #2)
                                                improves future briefs.

This is the Manager Agent operating *on top of* the single canonical state:
it reads blocked/stale tasks, open findings, the latest optimizer risks, and
upcoming meetings, then asks the model for one prioritized brief. The output
is advisory and read-only — nothing in the task graph is mutated.
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

# How old an in_progress task must be (no completion) before we call it "stale".
STALE_DAYS = 7


# ── Request / response shapes ─────────────────────────────────────────


class BriefItem(BaseModel):
    category: str = "general"
    title: str
    detail: str | None = None
    priority: str = "medium"


class DailyBriefOut(BaseModel):
    manager_action_id: UUID
    headline: str | None = None
    items: list[BriefItem] = Field(default_factory=list)
    summary: str | None = None
    # True when there was genuinely nothing to synthesize (empty state).
    quiet: bool = False


class BriefFeedbackIn(BaseModel):
    manager_action_id: UUID
    useful: bool
    note: str | None = Field(default=None, max_length=2000)


class BriefFeedbackOut(BaseModel):
    manager_action_id: UUID
    useful: bool


# ── Helpers ───────────────────────────────────────────────────────────


async def _load_project_workspace(session: AsyncSession, project_id: UUID) -> UUID:
    row = (
        await session.execute(
            text("select workspace_id from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    return UUID(str(row[0]))


async def _gather_state(session: AsyncSession, project_id: UUID) -> tuple[str, bool]:
    """Build the cross-feature state snapshot. Returns (text, has_signal)."""
    pid = {"pid": str(project_id)}

    project = (
        await session.execute(
            text("select name, vision, current_stage from public.projects where id = :pid"),
            pid,
        )
    ).first()
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    blocked = (
        await session.execute(
            text(
                """
                select t.title, coalesce(u.name, u.email) as owner, t.description
                from public.tasks t
                left join public.users u on t.owner_id = u.id
                where t.project_id = :pid and t.status = 'blocked'
                order by t.priority desc, t.created_at asc
                limit 20
                """
            ),
            pid,
        )
    ).all()

    stale = (
        await session.execute(
            text(
                """
                select t.title, coalesce(u.name, u.email) as owner,
                       extract(day from (now() - t.created_at))::int as age_days
                from public.tasks t
                left join public.users u on t.owner_id = u.id
                where t.project_id = :pid and t.status = 'in_progress'
                  and t.created_at < now() - make_interval(days => :stale_days)
                order by t.created_at asc
                limit 20
                """
            ),
            {**pid, "stale_days": STALE_DAYS},
        )
    ).all()

    findings = (
        await session.execute(
            text(
                """
                select how_to_use, created_at
                from public.findings
                where project_id = :pid and status in ('new','acknowledged')
                order by created_at desc
                limit 20
                """
            ),
            pid,
        )
    ).all()

    meetings = (
        await session.execute(
            text(
                """
                select type, scheduled_at, (ai_pre_brief is not null) as has_pre_brief
                from public.meetings
                where project_id = :pid and scheduled_at >= now()
                  and scheduled_at < now() + interval '7 days'
                order by scheduled_at asc
                limit 10
                """
            ),
            pid,
        )
    ).all()

    last_optimizer = (
        await session.execute(
            text(
                """
                select output, created_at
                from public.manager_actions
                where project_id = :pid and action_type = 'backlog_optimizer'
                order by created_at desc
                limit 1
                """
            ),
            pid,
        )
    ).first()

    has_signal = any([blocked, stale, findings, meetings])

    lines = [
        "# Project state snapshot",
        f"Name: {project[0]}",
        f"Vision: {project[1] or '—'}",
        f"Current stage: {project[2]}",
        "",
        "## Blocked tasks",
    ]
    if blocked:
        for t in blocked:
            desc = (t[2] or "").strip().replace("\n", " ")
            lines.append(f"- {t[0]} (owner: {t[1] or '—'})" + (f" — {desc[:160]}" if desc else ""))
    else:
        lines.append("- (none)")

    lines.append("")
    lines.append(f"## Stale in-progress (>{STALE_DAYS}d, no completion)")
    if stale:
        for t in stale:
            lines.append(f"- {t[0]} (owner: {t[1] or '—'}, ~{t[2]}d old)")
    else:
        lines.append("- (none)")

    lines.append("")
    lines.append("## Open findings (undismissed)")
    if findings:
        for f in findings:
            lines.append(f"- {(f[0] or '').strip()[:240]}")
    else:
        lines.append("- (none)")

    lines.append("")
    lines.append("## Upcoming meetings (next 7 days)")
    if meetings:
        for m in meetings:
            when = m[1].isoformat() if m[1] else "unscheduled"
            pre = "pre-brief ready" if m[2] else "no pre-brief yet"
            lines.append(f"- [{m[0]}] {when} ({pre})")
    else:
        lines.append("- (none)")

    lines.append("")
    lines.append("## Most recent backlog-optimizer output")
    if last_optimizer and isinstance(last_optimizer[0], dict):
        content = last_optimizer[0].get("content")
        if isinstance(content, str) and content.strip():
            lines.append(content[:1500])
        else:
            lines.append("- (no recent optimizer run)")
    else:
        lines.append("- (no recent optimizer run)")

    return "\n".join(lines), has_signal


async def _build_feedback_block(session: AsyncSession, project_id: UUID) -> str:
    """Inject prior daily-brief verdicts into the next prompt (design rule #2)."""
    rows = await llm.recent_feedback(session, project_id, "daily_brief", limit=10)
    if not rows:
        return ""
    lines = ["", "## Past feedback on your daily briefs"]
    for r in rows:
        fb = r.get("human_feedback")
        accepted = r.get("accepted_by_human")
        verdict = "USEFUL" if accepted is True else "NOT USEFUL" if accepted is False else "—"
        note = ""
        if isinstance(fb, str) and fb:
            note = fb[:400]
        elif isinstance(fb, dict):
            note = str(fb.get("note") or "")[:400]
        lines.append(f"- [{verdict}] {note}" if note else f"- [{verdict}]")
    return "\n".join(lines)


# ── POST /api/projects/{project_id}/daily_brief ───────────────────────


@router.post("/{project_id}/daily_brief", response_model=DailyBriefOut)
async def daily_brief(
    project_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> DailyBriefOut:
    workspace_id = await _load_project_workspace(session, project_id)

    stable_system = load_prompt("daily_brief_system")
    state, has_signal = await _gather_state(session, project_id)
    feedback_block = await _build_feedback_block(session, project_id)

    user_query = (
        "Produce today's brief from the project state above. "
        "Synthesize — surface only what is blocked, stale, risky, or time-sensitive."
    )
    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=state + feedback_block,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="daily_brief",
        messages=messages,
        session=session,
        project_id=project_id,
        workspace_id=workspace_id,
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=2048,
        audit_input={"has_signal": has_signal},
    )

    try:
        parsed: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model returned non-JSON: {exc}",
        ) from exc

    raw_items = parsed.get("items") or []
    items = [
        BriefItem(
            category=str(it.get("category", "general")),
            title=str(it.get("title", "")).strip() or "(untitled)",
            detail=it.get("detail"),
            priority=str(it.get("priority", "medium")),
        )
        for it in raw_items
        if isinstance(it, dict)
    ]

    action_row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = :pid and action_type = 'daily_brief'
                order by created_at desc limit 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()
    if action_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record the daily-brief action.",
        )

    return DailyBriefOut(
        manager_action_id=action_row[0],
        headline=parsed.get("headline"),
        items=items,
        summary=parsed.get("summary"),
        quiet=not has_signal,
    )


# ── POST /api/projects/{project_id}/daily_brief/feedback ──────────────


@router.post("/{project_id}/daily_brief/feedback", response_model=BriefFeedbackOut)
async def daily_brief_feedback(
    project_id: UUID,
    body: BriefFeedbackIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> BriefFeedbackOut:
    """Record a useful/not-useful verdict on a brief so future briefs improve."""
    await _load_project_workspace(session, project_id)

    result = await session.execute(
        text(
            """
            update public.manager_actions
               set accepted_by_human = :useful,
                   human_feedback = cast(:fb as jsonb)
             where id = :aid and project_id = :pid and action_type = 'daily_brief'
            returning id
            """
        ),
        {
            "useful": body.useful,
            "fb": json.dumps({"useful": body.useful, "note": body.note or ""}),
            "aid": str(body.manager_action_id),
            "pid": str(project_id),
        },
    )
    if result.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brief action not found.")

    return BriefFeedbackOut(manager_action_id=body.manager_action_id, useful=body.useful)
