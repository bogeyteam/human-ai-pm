"""Coaching API (M17 — V1 single-shot guided reflection).

Three endpoints, all strictly per-user-private:

  POST /api/coaching/start                 → opener + 3-5 reflection prompts
  POST /api/coaching/{session_id}/close    → insights + affirmations + closing
  POST /api/coaching/{session_id}/rate     → user rates the session

Privacy guarantees (design rule #5 in CLAUDE.md):
  - coaching_sessions RLS is `user_id = auth.uid()` ONLY — even founders
    cannot read another user's coaching transcripts.
  - We NEVER write to manager_actions for coaching (audit_target="coaching"
    on llm.generate). The audit row lands inside coaching_sessions itself.
  - The context we build for the LLM includes only THIS user's data —
    their owned tasks, their decisions, their meetings — never another
    workspace member's, even though they share a workspace.

Budget enforcement is NOT relaxed: the workspace still pays for the
spend, just without team-visible content. If the user has no workspace,
we 409 — coaching requires the budget cap to attach to something.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser, current_user
from app.llm import manager as llm
from app.llm.prompts import load as load_prompt

router = APIRouter(tags=["coaching"])
logger = logging.getLogger(__name__)


# ── Private context builder ───────────────────────────────────────────


async def _build_private_user_context(
    session: AsyncSession, user_id: UUID
) -> dict[str, Any]:
    """Build the context blob the LLM sees for THIS user only.

    NEVER includes other users' data, even within the same workspace.
    Every query filters by `user_id` / `owner_id` / `decided_by` /
    `attendees @> array[user_id]`.

    Returned dict is serialized to JSON and embedded as the
    project_state_snapshot segment of the prompt.
    """
    uid = str(user_id)

    # ── This user's tasks: active OR completed in last 30 days ────────
    task_rows = (
        await session.execute(
            text(
                """
                select t.title,
                       t.status,
                       t.estimated_hours,
                       t.actual_hours,
                       t.created_at,
                       t.completed_at,
                       p.name as project_name
                from public.tasks t
                join public.projects p on t.project_id = p.id
                where t.owner_id = cast(:uid as uuid)
                  and (
                    t.status in ('ready','in_progress','blocked')
                    or t.created_at > now() - interval '30 days'
                    or t.completed_at > now() - interval '30 days'
                  )
                order by
                  case t.status
                    when 'in_progress' then 0
                    when 'blocked' then 1
                    when 'ready' then 2
                    else 3
                  end,
                  coalesce(t.completed_at, t.created_at) desc
                limit 40
                """
            ),
            {"uid": uid},
        )
    ).all()

    tasks: list[dict[str, Any]] = []
    for r in task_rows:
        tasks.append(
            {
                "title": r[0],
                "status": r[1],
                "estimated_hours": float(r[2]) if r[2] is not None else None,
                "actual_hours": float(r[3]) if r[3] is not None else None,
                "created_at": r[4].isoformat() if r[4] else None,
                "completed_at": r[5].isoformat() if r[5] else None,
                "project_name": r[6],
            }
        )

    # ── This user's decisions in last 30 days ────────────────────────
    decision_rows = (
        await session.execute(
            text(
                """
                select d.question,
                       d.decision,
                       d.reasoning,
                       d.decided_at,
                       p.name as project_name
                from public.decisions d
                join public.projects p on d.project_id = p.id
                where d.decided_by = cast(:uid as uuid)
                  and d.decided_at > now() - interval '30 days'
                order by d.decided_at desc
                limit 15
                """
            ),
            {"uid": uid},
        )
    ).all()

    decisions: list[dict[str, Any]] = []
    for r in decision_rows:
        decisions.append(
            {
                "question": r[0],
                "decision": r[1],
                "reasoning": r[2],
                "decided_at": r[3].isoformat() if r[3] else None,
                "project_name": r[4],
            }
        )

    # ── Meetings the user attended, last 14 days ──────────────────────
    # `attendees uuid[]` — use array containment, cast the param.
    # `meetings` has no created_at column — filter by scheduled_at, and
    # include rows with NULL scheduled_at as "recently created" (treated
    # as in-window since there's no other timestamp to compare against).
    meeting_rows = (
        await session.execute(
            text(
                """
                select m.type,
                       m.scheduled_at,
                       (m.notes is not null and length(m.notes) > 0) as has_notes,
                       p.name as project_name
                from public.meetings m
                join public.projects p on m.project_id = p.id
                where m.attendees @> array[cast(:uid as uuid)]
                  and (
                    m.scheduled_at is null
                    or m.scheduled_at > now() - interval '14 days'
                  )
                order by m.scheduled_at desc nulls last
                limit 20
                """
            ),
            {"uid": uid},
        )
    ).all()

    meetings: list[dict[str, Any]] = []
    for r in meeting_rows:
        meetings.append(
            {
                "type": r[0],
                "scheduled_at": r[1].isoformat() if r[1] else None,
                "has_notes": bool(r[2]),
                "project_name": r[3],
            }
        )

    # ── Prior coaching sessions for this user (last 5) ────────────────
    prior_rows = (
        await session.execute(
            text(
                """
                select created_at,
                       insights
                from public.coaching_sessions
                where user_id = cast(:uid as uuid)
                order by created_at desc
                limit 5
                """
            ),
            {"uid": uid},
        )
    ).all()

    prior_sessions: list[dict[str, Any]] = []
    for r in prior_rows:
        insights = r[1] if isinstance(r[1], dict) else {}
        prior_sessions.append(
            {
                "created_at": r[0].isoformat() if r[0] else None,
                "user_rating": insights.get("user_rating"),
                "user_followup_note": insights.get("user_followup_note"),
            }
        )

    return {
        "user_id": uid,
        "owned_tasks": tasks,
        "decisions": decisions,
        "meetings_attended": meetings,
        "prior_coaching_sessions": prior_sessions,
    }


def _serialize_context(ctx: dict[str, Any]) -> str:
    """Render the private context into the project_state slot.

    Plain JSON inside a fenced block — the model parses it fine, and we
    keep the prompt-caching shape stable (system | state | user query).
    """
    return (
        "# Private user state (only this user — never another team member)\n\n"
        "```json\n"
        + json.dumps(ctx, ensure_ascii=False, indent=2)
        + "\n```"
    )


# ── Helpers ───────────────────────────────────────────────────────────


async def _resolve_workspace_id(session: AsyncSession, user_id: UUID) -> UUID:
    """The user must belong to a workspace — budget cap attaches there.
    409 if missing (coaching is gated until the user has joined one)."""
    row = (
        await session.execute(
            text("select workspace_id from public.users where id = cast(:uid as uuid)"),
            {"uid": str(user_id)},
        )
    ).first()
    if row is None or row[0] is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Coaching requires a workspace — join one before starting.",
        )
    return UUID(str(row[0]))


async def _load_session(
    session: AsyncSession, session_id: UUID, user_id: UUID
) -> dict[str, Any]:
    """Load a coaching_sessions row, asserting ownership.

    Returns 404 (not 403) on mismatch — that avoids leaking existence of
    other users' sessions to a curious caller.
    """
    row = (
        await session.execute(
            text(
                """
                select id, user_id, project_context_snapshot, transcript, insights, created_at
                from public.coaching_sessions
                where id = cast(:sid as uuid)
                """
            ),
            {"sid": str(session_id)},
        )
    ).first()
    if row is None or UUID(str(row[1])) != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Coaching session not found.",
        )
    return {
        "id": UUID(str(row[0])),
        "user_id": UUID(str(row[1])),
        "project_context_snapshot": row[2] if isinstance(row[2], dict) else {},
        "transcript": row[3],
        "insights": row[4] if isinstance(row[4], dict) else {},
        "created_at": row[5],
    }


def _parse_transcript(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


# ── /start ────────────────────────────────────────────────────────────


class ReflectionPrompt(BaseModel):
    category: str
    prompt: str
    data_hook: str | None = None


class StartCoachingOut(BaseModel):
    session_id: UUID
    opener: str
    reflection_prompts: list[ReflectionPrompt]


@router.post("/api/coaching/start", response_model=StartCoachingOut)
async def start_coaching(
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StartCoachingOut:
    workspace_id = await _resolve_workspace_id(session, user.id)

    # Build context — strictly per-user.
    ctx = await _build_private_user_context(session, user.id)

    stable_system = load_prompt("coaching_session_system")
    project_state = _serialize_context(ctx)
    user_query = json.dumps(
        {
            "mode": "open",
            "instructions": (
                "Generate 3–5 personalized reflection prompts grounded in the "
                "private user state above. Output strict JSON only."
            ),
        },
        ensure_ascii=False,
    )

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    # project_id is a required column on manager_actions, but coaching
    # SKIPS that INSERT. We still need to pass something — use a stable
    # placeholder UUID derived from the user. (audit_target='coaching'
    # means the value is never read.) See manager.generate() docstring.
    project_id_placeholder = uuid4()

    content, _usage = await llm.generate(
        task_type="coaching_session",
        messages=messages,
        session=session,
        project_id=project_id_placeholder,
        workspace_id=workspace_id,
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=1500,
        audit_target="coaching",  # SKIP manager_actions INSERT
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Coaching model returned non-JSON: {exc}",
        ) from exc

    opener = parsed.get("opener") or ""
    raw_prompts = parsed.get("reflection_prompts") or []
    prompts = [
        ReflectionPrompt(
            category=p.get("category", "work_style"),
            prompt=p.get("prompt", ""),
            data_hook=p.get("data_hook"),
        )
        for p in raw_prompts
        if isinstance(p, dict) and (p.get("prompt") or "").strip()
    ]

    # Persist a row. transcript stores mode A output so /close can
    # reference the original prompts when assembling mode B input.
    new_row = (
        await session.execute(
            text(
                """
                insert into public.coaching_sessions
                  (user_id, project_context_snapshot, transcript, insights)
                values (
                  cast(:uid as uuid),
                  cast(:ctx as jsonb),
                  cast(:transcript as text),
                  cast('{}' as jsonb)
                )
                returning id
                """
            ),
            {
                "uid": str(user.id),
                "ctx": json.dumps(ctx, ensure_ascii=False),
                "transcript": json.dumps(
                    {"mode_a_output": parsed}, ensure_ascii=False
                ),
            },
        )
    ).first()
    if new_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create coaching session.",
        )
    new_id = UUID(str(new_row[0]))

    logger.info(
        "coaching.start session_id=%s user_id=%s prompts=%d",
        new_id,
        user.id,
        len(prompts),
    )

    return StartCoachingOut(
        session_id=new_id, opener=opener, reflection_prompts=prompts
    )


# ── /{session_id}/close ───────────────────────────────────────────────


class CoachingAnswer(BaseModel):
    prompt_index: int = Field(..., ge=0)
    text: str


class CloseCoachingIn(BaseModel):
    answers: list[CoachingAnswer]
    duration_ms: int | None = None


class CloseCoachingOut(BaseModel):
    insights: list[str]
    affirmations: list[str]
    closing_note: str


@router.post(
    "/api/coaching/{session_id}/close", response_model=CloseCoachingOut
)
async def close_coaching(
    session_id: UUID,
    body: CloseCoachingIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> CloseCoachingOut:
    workspace_id = await _resolve_workspace_id(session, user.id)
    row = await _load_session(session, session_id, user.id)

    prior_transcript = _parse_transcript(row["transcript"])
    mode_a_output = prior_transcript.get("mode_a_output") or {}
    original_prompts = mode_a_output.get("reflection_prompts") or []

    # Pair answers with their original prompts so the LLM has full context.
    paired: list[dict[str, Any]] = []
    for ans in body.answers:
        original = (
            original_prompts[ans.prompt_index]
            if 0 <= ans.prompt_index < len(original_prompts)
            else None
        )
        paired.append(
            {
                "prompt_index": ans.prompt_index,
                "original_prompt": original,
                "answer_text": ans.text,
            }
        )

    # Rebuild the project_state from the stored context so the closing
    # has the same grounding as the opening — this preserves prompt
    # caching across the two calls in the same session.
    ctx = row["project_context_snapshot"] or {}
    stable_system = load_prompt("coaching_session_system")
    project_state = _serialize_context(ctx)
    user_query = json.dumps(
        {
            "mode": "close",
            "original_opener": mode_a_output.get("opener"),
            "answers": paired,
            "instructions": (
                "The user has filled in their answers. Reflect back with "
                "insights + affirmations + a closing note. Output strict "
                "JSON only — no preamble, no markdown fences."
            ),
        },
        ensure_ascii=False,
    )

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="coaching_session",
        messages=messages,
        session=session,
        project_id=uuid4(),  # placeholder — INSERT skipped, see /start
        workspace_id=workspace_id,
        response_format={"type": "json_object"},
        temperature=0.5,
        max_tokens=1500,
        audit_target="coaching",
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Coaching model returned non-JSON: {exc}",
        ) from exc

    insights = [s for s in (parsed.get("insights") or []) if isinstance(s, str)]
    affirmations = [
        s for s in (parsed.get("affirmations") or []) if isinstance(s, str)
    ]
    closing_note = parsed.get("closing_note") or ""

    # Persist the close: extend the transcript with mode B output + answers,
    # set insights JSONB to the structured output so future /start calls
    # can use prior insights metadata if they want to.
    new_transcript = {
        **prior_transcript,
        "answers": [a.model_dump() for a in body.answers],
        "duration_ms": body.duration_ms,
        "mode_b_output": parsed,
    }

    await session.execute(
        text(
            """
            update public.coaching_sessions
              set transcript = cast(:t as text),
                  insights = cast(:i as jsonb)
              where id = cast(:sid as uuid)
                and user_id = cast(:uid as uuid)
            """
        ),
        {
            "t": json.dumps(new_transcript, ensure_ascii=False),
            "i": json.dumps(
                {
                    "insights": insights,
                    "affirmations": affirmations,
                    "closing_note": closing_note,
                },
                ensure_ascii=False,
            ),
            "sid": str(session_id),
            "uid": str(user.id),
        },
    )

    logger.info(
        "coaching.close session_id=%s user_id=%s answers=%d insights=%d",
        session_id,
        user.id,
        len(body.answers),
        len(insights),
    )

    return CloseCoachingOut(
        insights=insights, affirmations=affirmations, closing_note=closing_note
    )


# ── /{session_id}/rate ────────────────────────────────────────────────


class RateCoachingIn(BaseModel):
    rating: Literal["useful", "not_useful"]
    note: str | None = None


class RateCoachingOut(BaseModel):
    ok: bool


@router.post(
    "/api/coaching/{session_id}/rate", response_model=RateCoachingOut
)
async def rate_coaching(
    session_id: UUID,
    body: RateCoachingIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> RateCoachingOut:
    row = await _load_session(session, session_id, user.id)

    current_insights = row["insights"] or {}
    new_insights = {
        **current_insights,
        "user_rating": body.rating,
        "user_followup_note": body.note,
    }

    await session.execute(
        text(
            """
            update public.coaching_sessions
              set insights = cast(:i as jsonb)
              where id = cast(:sid as uuid)
                and user_id = cast(:uid as uuid)
            """
        ),
        {
            "i": json.dumps(new_insights, ensure_ascii=False),
            "sid": str(session_id),
            "uid": str(user.id),
        },
    )

    logger.info(
        "coaching.rate session_id=%s user_id=%s rating=%s",
        session_id,
        user.id,
        body.rating,
    )

    return RateCoachingOut(ok=True)
