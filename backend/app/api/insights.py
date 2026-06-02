"""Manager learning insights (M21 / Track C3).

GET /api/projects/{id}/insights — read-only aggregates over `manager_actions`,
making the feedback loop (design rule #2) visible: accept/edit/reject rates per
action_type, the distribution of rejection reason chips, weekly AI activity, and
today's LLM spend against the workspace cap.

No LLM calls; pure SQL aggregation + a little Python over `human_feedback`.
"""

from __future__ import annotations

import json
from collections import Counter
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser, current_user
from app.llm import budget

router = APIRouter(tags=["insights"], prefix="/api/projects")


# ── Response shapes ───────────────────────────────────────────────────


class ActionTypeStat(BaseModel):
    action_type: str
    total: int
    accepted: int
    rejected: int
    pending: int
    accept_rate: float | None = None  # over reviewed (accepted+rejected) only


class WeekBucket(BaseModel):
    week_start: str
    count: int


class RejectReason(BaseModel):
    reason: str
    count: int


class SpendInfo(BaseModel):
    today_usd: float
    budget_usd: float
    remaining_usd: float


class InsightsOut(BaseModel):
    per_action_type: list[ActionTypeStat] = Field(default_factory=list)
    totals: ActionTypeStat
    weekly_activity: list[WeekBucket] = Field(default_factory=list)
    top_reject_reasons: list[RejectReason] = Field(default_factory=list)
    spend: SpendInfo


# ── Helpers ───────────────────────────────────────────────────────────


def _accept_rate(accepted: int, rejected: int) -> float | None:
    reviewed = accepted + rejected
    return round(accepted / reviewed, 3) if reviewed else None


def _collect_reason_chips(node: Any, out: list[str]) -> None:
    """Recursively pull any `*reason_chip` values out of a human_feedback blob.

    Feedback shapes differ per feature (task gen, findings, optimizer, tags all
    store reject reasons under slightly different keys), so we walk the structure
    and collect every key that ends in `reason_chip`.

    `manager_actions.human_feedback` is a TEXT column holding a JSON *string*
    (asyncpg returns it un-deserialized), so the top-level value arrives as a
    `str`. Parse it once before walking; silently skip rows that aren't JSON.
    """
    if isinstance(node, str):
        try:
            parsed = json.loads(node)
        except (TypeError, ValueError):
            return
        if isinstance(parsed, (dict, list)):
            _collect_reason_chips(parsed, out)
        return
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(k, str) and k.endswith("reason_chip") and isinstance(v, str) and v.strip():
                out.append(v.strip())
            else:
                _collect_reason_chips(v, out)
    elif isinstance(node, list):
        for item in node:
            _collect_reason_chips(item, out)


# ── GET /api/projects/{project_id}/insights ───────────────────────────


@router.get("/{project_id}/insights", response_model=InsightsOut)
async def project_insights(
    project_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> InsightsOut:
    ws_row = (
        await session.execute(
            text("select workspace_id from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if ws_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    workspace_id = UUID(str(ws_row[0]))

    rows = (
        await session.execute(
            text(
                """
                select action_type,
                       count(*) as total,
                       count(*) filter (where accepted_by_human is true)  as accepted,
                       count(*) filter (where accepted_by_human is false) as rejected,
                       count(*) filter (where accepted_by_human is null)  as pending
                from public.manager_actions
                where project_id = :pid
                group by action_type
                order by total desc
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()

    per_action_type: list[ActionTypeStat] = []
    t_total = t_acc = t_rej = t_pend = 0
    for r in rows:
        accepted, rejected, pending, total = int(r[2]), int(r[3]), int(r[4]), int(r[1])
        per_action_type.append(
            ActionTypeStat(
                action_type=r[0],
                total=total,
                accepted=accepted,
                rejected=rejected,
                pending=pending,
                accept_rate=_accept_rate(accepted, rejected),
            )
        )
        t_total += total
        t_acc += accepted
        t_rej += rejected
        t_pend += pending

    totals = ActionTypeStat(
        action_type="all",
        total=t_total,
        accepted=t_acc,
        rejected=t_rej,
        pending=t_pend,
        accept_rate=_accept_rate(t_acc, t_rej),
    )

    weekly = (
        await session.execute(
            text(
                """
                select date_trunc('week', created_at) as wk, count(*)
                from public.manager_actions
                where project_id = :pid
                  and created_at > now() - interval '8 weeks'
                group by wk
                order by wk
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()
    weekly_activity = [
        WeekBucket(week_start=w[0].date().isoformat(), count=int(w[1])) for w in weekly if w[0]
    ]

    # Reason-chip distribution — best-effort over rows that carry feedback.
    fb_rows = (
        await session.execute(
            text(
                """
                select human_feedback
                from public.manager_actions
                where project_id = :pid and human_feedback is not null
                order by created_at desc
                limit 500
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()
    chips: list[str] = []
    for (fb,) in fb_rows:
        _collect_reason_chips(fb, chips)
    top_reject_reasons = [
        RejectReason(reason=reason, count=count)
        for reason, count in Counter(chips).most_common(8)
    ]

    today_usd = await budget.spent_today_usd(session, workspace_id)
    budget_usd = await budget.workspace_budget_usd(session, workspace_id)
    spend = SpendInfo(
        today_usd=round(today_usd, 4),
        budget_usd=round(budget_usd, 2),
        remaining_usd=round(max(budget_usd - today_usd, 0.0), 4),
    )

    return InsightsOut(
        per_action_type=per_action_type,
        totals=totals,
        weekly_activity=weekly_activity,
        top_reject_reasons=top_reject_reasons,
        spend=spend,
    )
