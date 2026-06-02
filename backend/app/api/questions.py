"""Open Question Engine API (M21 — BET #4, Slice 1).

POST /api/projects/{id}/questions/derive   — run the derive worker (≤1 model call).
POST /api/questions/{id}/respond           — Accept / Edit / Dismiss a card; writes
                                             the verdict back to the producing
                                             manager_actions row (closes the loop).
POST /api/questions/{id}/resolve           — the human supplied the real-world answer;
                                             land it as a HUMAN-GATED decision or
                                             artifact and mark the question answered.
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
from app.workers.derive_open_questions import run_derive

router = APIRouter(tags=["ai"])


# ── Derive ─────────────────────────────────────────────────────────────


class DeriveOut(BaseModel):
    question_ids: list[UUID]
    candidate_count: int
    written: int
    dropped_dup: int


@router.post("/api/projects/{project_id}/questions/derive", response_model=DeriveOut)
async def derive(
    project_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> DeriveOut:
    row = (
        await session.execute(
            text("select workspace_id from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    workspace_id = UUID(str(row[0]))

    result = await run_derive(session, project_id, workspace_id)
    return DeriveOut(
        question_ids=[UUID(s) for s in result["question_ids"]],
        candidate_count=result["candidate_count"],
        written=result["written"],
        dropped_dup=result["dropped_dup"],
    )


# ── Feedback-loop helper (mirrors findings.respond) ────────────────────


async def _append_verdict(
    session: AsyncSession, manager_action_id: UUID | None, verdict: dict
) -> None:
    """Append one card's verdict to the producing manager_action and recompute
    accepted_by_human across ALL verdicts in that batch (a derive writes up to 3
    cards sharing one manager_action_id)."""
    if manager_action_id is None:
        return
    existing = (
        await session.execute(
            text(
                "select accepted_by_human, human_feedback "
                "from public.manager_actions where id = :id"
            ),
            {"id": str(manager_action_id)},
        )
    ).first()
    prior: dict = {}
    if existing and existing[1]:
        try:
            prior = json.loads(existing[1])
        except (json.JSONDecodeError, TypeError):
            prior = {"raw": existing[1]}
    prior.setdefault("verdicts", []).append(verdict)
    any_accepted = any(
        v.get("action") in ("accept", "edit", "resolve") for v in prior["verdicts"]
    )
    await session.execute(
        text(
            "update public.manager_actions "
            "set accepted_by_human = :acc, human_feedback = :fb where id = :id"
        ),
        {
            "acc": any_accepted,
            "fb": json.dumps(prior, ensure_ascii=False),
            "id": str(manager_action_id),
        },
    )


# ── Respond (accept / edit / dismiss) ──────────────────────────────────


class QuestionRespondIn(BaseModel):
    action: Literal["accept", "edit", "dismiss"]
    # edit-only:
    edited_question: str | None = None
    edited_outreach_zh: str | None = None
    edited_outreach_en: str | None = None
    edited_owner_id: UUID | None = None
    # dismiss-only (a reason is required):
    reason_chip: str | None = None
    reason_free: str | None = None
    feedback_note: str | None = None


class QuestionRespondOut(BaseModel):
    question_id: UUID
    status: str


@router.post("/api/questions/{question_id}/respond", response_model=QuestionRespondOut)
async def respond(
    question_id: UUID,
    body: QuestionRespondIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> QuestionRespondOut:
    q = (
        await session.execute(
            text(
                "select id, project_id, manager_action_id, question, status "
                "from public.open_questions where id = :qid"
            ),
            {"qid": str(question_id)},
        )
    ).first()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")

    if body.action == "dismiss" and not body.reason_chip and not (body.reason_free or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dismiss requires a reason — pick a chip or write one.",
        )

    is_dismiss = body.action == "dismiss"
    new_status = "dismissed" if is_dismiss else "routed"  # accept/edit keep the card live

    await session.execute(
        text(
            """
            update public.open_questions set
              status = :st,
              question = coalesce(:eq, question),
              drafted_message_zh = coalesce(:emzh, drafted_message_zh),
              drafted_message_en = coalesce(:emen, drafted_message_en),
              target_owner_id = coalesce(:eowner, target_owner_id),
              dismiss_reason = :dreason,
              feedback_note = :note,
              resolved_at = case when :is_dismiss then now() else null end
            where id = :qid
            """
        ),
        {
            "st": new_status,
            "eq": body.edited_question if body.action == "edit" else None,
            "emzh": body.edited_outreach_zh if body.action == "edit" else None,
            "emen": body.edited_outreach_en if body.action == "edit" else None,
            "eowner": str(body.edited_owner_id) if body.edited_owner_id else None,
            "dreason": (body.reason_chip or body.reason_free) if is_dismiss else None,
            "note": body.feedback_note,
            "is_dismiss": is_dismiss,
            "qid": str(question_id),
        },
    )

    await _append_verdict(
        session,
        UUID(str(q[2])) if q[2] else None,
        {
            "question_id": str(question_id),
            "action": body.action,
            "question": q[3],
            "reason_chip": body.reason_chip,
            "reason_free": body.reason_free,
            "feedback_note": body.feedback_note,
        },
    )
    return QuestionRespondOut(question_id=question_id, status=new_status)


# ── Resolve (the human's real-world answer lands as a gated row) ───────


class QuestionResolveIn(BaseModel):
    answer_text: str
    land_as: Literal["decision", "artifact"]
    decision_reasoning: str | None = None
    decision_alternatives: str | None = None
    artifact_title: str | None = None


class QuestionResolveOut(BaseModel):
    question_id: UUID
    status: str
    landed_kind: str
    landed_id: UUID


@router.post("/api/questions/{question_id}/resolve", response_model=QuestionResolveOut)
async def resolve(
    question_id: UUID,
    body: QuestionResolveIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> QuestionResolveOut:
    if not (body.answer_text or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="An answer is required to resolve."
        )

    q = (
        await session.execute(
            text(
                "select id, project_id, manager_action_id, question, source_task_id "
                "from public.open_questions where id = :qid"
            ),
            {"qid": str(question_id)},
        )
    ).first()
    if q is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")
    project_id = UUID(str(q[1]))
    question_text = q[3]
    source_task_id = q[4]

    if body.land_as == "decision":
        landed = (
            await session.execute(
                text(
                    """
                    insert into public.decisions
                      (project_id, question, decision, reasoning, alternatives_considered,
                       decided_by, decided_at)
                    values (:pid, :q, :ans, :reasoning, :alts, :uid, now())
                    returning id
                    """
                ),
                {
                    "pid": str(project_id),
                    "q": question_text,
                    "ans": body.answer_text.strip(),
                    "reasoning": body.decision_reasoning,
                    "alts": body.decision_alternatives,
                    "uid": str(user.id),
                },
            )
        ).first()
        landed_id = UUID(str(landed[0]))
        await session.execute(
            text(
                "update public.open_questions set status = 'answered', resolved_at = now(), "
                "resolution_decision_id = :did where id = :qid"
            ),
            {"did": str(landed_id), "qid": str(question_id)},
        )
        landed_kind = "decision"
    else:
        landed = (
            await session.execute(
                text(
                    """
                    insert into public.artifacts
                      (project_id, task_id, type, title, content)
                    values (:pid, :tid, 'decision', :title, :content)
                    returning id
                    """
                ),
                {
                    "pid": str(project_id),
                    "tid": str(source_task_id) if source_task_id else None,
                    "title": (body.artifact_title or question_text)[:300],
                    "content": body.answer_text.strip(),
                },
            )
        ).first()
        landed_id = UUID(str(landed[0]))
        await session.execute(
            text(
                "update public.open_questions set status = 'answered', resolved_at = now(), "
                "resolution_artifact_id = :aid where id = :qid"
            ),
            {"aid": str(landed_id), "qid": str(question_id)},
        )
        landed_kind = "artifact"

    await _append_verdict(
        session,
        UUID(str(q[2])) if q[2] else None,
        {
            "question_id": str(question_id),
            "action": "resolve",
            "question": question_text,
            "landed_kind": landed_kind,
        },
    )
    return QuestionResolveOut(
        question_id=question_id, status="answered", landed_kind=landed_kind, landed_id=landed_id
    )
