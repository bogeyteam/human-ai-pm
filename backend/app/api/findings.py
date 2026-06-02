"""Findings API (M6).

POST /api/projects/{id}/discover           — runs the discovery worker.
POST /api/findings/{id}/respond            — user verdict on one finding.
                                             Writes structured feedback to
                                             both the finding row and the
                                             associated manager_actions row,
                                             so the feedback loop closes.
"""

from __future__ import annotations

import json
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser, current_user
from app.workers.discover_findings import run_discovery

router = APIRouter(tags=["ai"])


class DiscoverOut(BaseModel):
    finding_ids: list[UUID]
    candidate_count: int
    written: int


@router.post("/api/projects/{project_id}/discover", response_model=DiscoverOut)
async def discover(
    project_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> DiscoverOut:
    # Post-M13: any signed-in caller can run discovery on any project.
    # Look up the project's workspace_id so the budget cap applies to
    # the right workspace.
    row = (
        await session.execute(
            text("select workspace_id from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    project_workspace_id = UUID(str(row[0]))

    result = await run_discovery(session, project_id, project_workspace_id)
    return DiscoverOut(
        finding_ids=[UUID(s) for s in result["finding_ids"]],
        candidate_count=result["candidate_count"],
        written=result["written"],
    )


# ── Respond (acknowledge / link / dismiss) ────────────────────────────


class RespondIn(BaseModel):
    action: Literal["acknowledge", "link", "dismiss"]
    # Only used when action == "dismiss":
    reason_chip: str | None = None
    reason_free: str | None = None
    # Only used when action == "link" — optional note explaining the link.
    feedback_note: str | None = None


class RespondOut(BaseModel):
    finding_id: UUID
    status: str


@router.post("/api/findings/{finding_id}/respond", response_model=RespondOut)
async def respond(
    finding_id: UUID,
    body: RespondIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> RespondOut:
    finding = (
        await session.execute(
            text(
                """
                select f.id, f.project_id, f.manager_action_id, f.target_task_id, f.how_to_use,
                       f.source_artifact_id
                from public.findings f
                where f.id = :fid
                """
            ),
            {"fid": str(finding_id)},
        )
    ).first()
    if finding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Finding not found.")

    if body.action == "dismiss" and not body.reason_chip and not (body.reason_free or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dismiss requires a reason — pick a chip or write one.",
        )

    new_status = {
        "acknowledge": "acknowledged",
        "link": "linked",
        "dismiss": "dismissed",
    }[body.action]

    await session.execute(
        text(
            """
            update public.findings
              set status = :st,
                  dismiss_reason = :reason,
                  feedback_note = :note,
                  resolved_at = now()
              where id = :fid
            """
        ),
        {
            "st": new_status,
            "reason": body.reason_chip or body.reason_free,
            "note": body.feedback_note,
            "fid": str(finding_id),
        },
    )

    # Feedback loop: append this finding's verdict to the manager_action
    # row that produced it. The next info_discovery prompt pulls this in
    # via llm.recent_feedback().
    if finding[2] is not None:
        existing = (
            await session.execute(
                text("select accepted_by_human, human_feedback from public.manager_actions where id = :id"),
                {"id": str(finding[2])},
            )
        ).first()
        prior_feedback: dict = {}
        if existing and existing[1]:
            try:
                prior_feedback = json.loads(existing[1])
            except Exception:
                prior_feedback = {"raw": existing[1]}
        prior_feedback.setdefault("verdicts", []).append(
            {
                "finding_id": str(finding_id),
                "action": body.action,
                "how_to_use": finding[4],
                "reason_chip": body.reason_chip,
                "reason_free": body.reason_free,
                "feedback_note": body.feedback_note,
            }
        )
        # accepted_by_human: True if ANY downstream finding accepted/linked, else last verdict.
        any_accepted = any(v["action"] in ("acknowledge", "link") for v in prior_feedback["verdicts"])
        await session.execute(
            text(
                """
                update public.manager_actions
                  set accepted_by_human = :acc,
                      human_feedback = :fb
                  where id = :id
                """
            ),
            {
                "acc": any_accepted,
                "fb": json.dumps(prior_feedback, ensure_ascii=False),
                "id": str(finding[2]),
            },
        )

    return RespondOut(finding_id=finding_id, status=new_status)
