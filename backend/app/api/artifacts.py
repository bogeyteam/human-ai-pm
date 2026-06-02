"""Artifact tag-suggestion endpoints (M20).

Two endpoints, mirroring the M5 generate/persist shape:

  POST /api/artifacts/{aid}/suggest_tags  → propose 2-4 tags for one artifact
  POST /api/artifacts/{aid}/apply_tags    → apply per-proposal verdicts;
                                            create+link or reject; write
                                            structured feedback to
                                            manager_actions for the loop.

CRUD on tags / artifact_tags / saved_views (the listing reads + naive
create) goes through Supabase JS direct from the frontend — RLS on those
tables enforces signed-in only. The backend touches these tables only
for AI-orchestrated writes (apply_tags) so we can keep the audit row
consistent with the proposal that produced it.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.deps import CurrentUser, current_user
from app.llm import manager as llm
from app.llm.prompts import load as load_prompt

router = APIRouter(tags=["ai"])
logger = logging.getLogger(__name__)


_ALLOWED_KINDS = ("topic", "phase", "persona", "custom")


# ── Helpers ───────────────────────────────────────────────────────────


async def _load_artifact(
    session: AsyncSession, artifact_id: UUID
) -> dict[str, Any]:
    """Fetch artifact + the project's workspace_id (for budget cap) +
    optional linked task title (extra context for the model)."""
    row = (
        await session.execute(
            text(
                """
                select a.id, a.project_id, a.title, a.type,
                       coalesce(a.content, '') as content,
                       a.task_id,
                       coalesce(t.title, '') as task_title,
                       p.workspace_id
                from public.artifacts a
                join public.projects p on a.project_id = p.id
                left join public.tasks t on a.task_id = t.id
                where a.id = cast(:aid as uuid)
                """
            ),
            {"aid": str(artifact_id)},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found."
        )
    return {
        "id": UUID(str(row[0])),
        "project_id": UUID(str(row[1])),
        "title": row[2] or "(untitled)",
        "type": row[3] or "doc",
        "content": row[4] or "",
        "task_id": UUID(str(row[5])) if row[5] else None,
        "task_title": row[6] or "",
        "project_workspace_id": UUID(str(row[7])),
    }


async def _existing_project_tags(
    session: AsyncSession, project_id: UUID
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                """
                select id, name, kind
                from public.tags
                where project_id = cast(:pid as uuid)
                order by name
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()
    return [
        {"id": str(r[0]), "name": r[1], "kind": r[2]} for r in rows
    ]


async def _existing_artifact_tags(
    session: AsyncSession, artifact_id: UUID
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                """
                select t.id, t.name, t.kind
                from public.tags t
                join public.artifact_tags at on t.id = at.tag_id
                where at.artifact_id = cast(:aid as uuid)
                order by t.name
                """
            ),
            {"aid": str(artifact_id)},
        )
    ).all()
    return [
        {"id": str(r[0]), "name": r[1], "kind": r[2]} for r in rows
    ]


async def _build_feedback_block(
    session: AsyncSession, project_id: UUID
) -> str:
    rows = await llm.recent_feedback(
        session, project_id, "tag_suggestion", limit=10
    )
    if not rows:
        return ""

    lines = ["", "## Past feedback on your tag suggestions"]
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
        if isinstance(feedback, dict):
            lines.append(json.dumps(feedback, ensure_ascii=False)[:1200])
        elif feedback:
            lines.append(str(feedback)[:1200])
    return "\n".join(lines)


def _build_project_state(
    existing_tags: list[dict[str, Any]],
    artifact_tags: list[dict[str, Any]],
    feedback_block: str,
) -> str:
    """Project-state snapshot for the tag-suggestion prompt.

    Tag vocabulary changes slowly, and the existing tags ARE the project
    state for this task. Kept compact so the cacheable middle segment
    stays cache-friendly across calls within a project.
    """
    lines: list[str] = ["# Project tag vocabulary"]
    if existing_tags:
        for t in existing_tags:
            lines.append(f"- {t['name']} ({t['kind']})")
    else:
        lines.append("- (no tags yet — propose the project's starter vocabulary)")

    lines.append("")
    lines.append("## Already on this artifact (do NOT re-propose these)")
    if artifact_tags:
        for t in artifact_tags:
            lines.append(f"- {t['name']} ({t['kind']})")
    else:
        lines.append("- (none)")

    if feedback_block:
        lines.append(feedback_block)
    return "\n".join(lines)


def _build_user_query(artifact: dict[str, Any]) -> str:
    content = artifact["content"]
    excerpt = content[:3000] + ("…" if len(content) > 3000 else "")
    parts = [
        "## Artifact to tag",
        f"Title: {artifact['title']}",
        f"Type: {artifact['type']}",
    ]
    if artifact["task_title"]:
        parts.append(f"Linked task: {artifact['task_title']}")
    parts.append("")
    parts.append("### Content")
    parts.append(excerpt or "(no content — use title + linked task only)")
    parts.append("")
    parts.append(
        "请基于上面 project tag vocabulary 提议 2-4 个 tag。"
        "Reuse existing tags whenever possible. Output strict JSON only."
    )
    return "\n".join(parts)


# ── /suggest_tags ─────────────────────────────────────────────────────


class TagProposal(BaseModel):
    index: int
    tag_name: str
    kind: str
    rationale_en: str | None = None
    rationale_cn: str | None = None


class SuggestTagsOut(BaseModel):
    manager_action_id: UUID
    proposals: list[TagProposal]


@router.post(
    "/api/artifacts/{artifact_id}/suggest_tags", response_model=SuggestTagsOut
)
async def suggest_tags(
    artifact_id: UUID,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> SuggestTagsOut:
    artifact = await _load_artifact(session, artifact_id)

    existing_tags = await _existing_project_tags(session, artifact["project_id"])
    artifact_tags = await _existing_artifact_tags(session, artifact_id)
    feedback_block = await _build_feedback_block(session, artifact["project_id"])

    stable_system = load_prompt("tag_suggestion_system")
    project_state = _build_project_state(
        existing_tags, artifact_tags, feedback_block
    )
    user_query = _build_user_query(artifact)

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="tag_suggestion",
        messages=messages,
        session=session,
        project_id=artifact["project_id"],
        workspace_id=artifact["project_workspace_id"],
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=800,
        audit_input={
            "artifact_id": str(artifact_id),
            "artifact_type": artifact["type"],
            "existing_tag_count": len(existing_tags),
            "artifact_tag_count": len(artifact_tags),
        },
        audit_target="manager_actions",
    )

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Model returned non-JSON: {exc}",
        ) from exc

    raw_proposals = parsed.get("proposals") or []
    proposals: list[TagProposal] = []
    for i, p in enumerate(raw_proposals):
        if not isinstance(p, dict):
            continue
        name = (p.get("tag_name") or "").strip()
        if not name:
            continue
        kind = (p.get("kind") or "topic").strip().lower()
        if kind not in _ALLOWED_KINDS:
            kind = "topic"  # coerce unknown kinds to default rather than rejecting
        proposals.append(
            TagProposal(
                index=i,
                tag_name=name,
                kind=kind,
                rationale_en=(p.get("rationale_en") or None),
                rationale_cn=(p.get("rationale_cn") or None),
            )
        )
        if len(proposals) >= 4:
            break  # hard cap per prompt contract

    # Look up the manager_action row llm.generate() just wrote so the
    # frontend can reference it on /apply_tags.
    action_row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = cast(:pid as uuid)
                  and action_type = 'tag_suggestion'
                order by created_at desc limit 1
                """
            ),
            {"pid": str(artifact["project_id"])},
        )
    ).first()
    if action_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record the tag-suggestion action.",
        )
    manager_action_id = UUID(str(action_row[0]))

    logger.info(
        "tag_suggestion.suggest artifact=%s proposals=%d existing_tags=%d",
        artifact_id,
        len(proposals),
        len(existing_tags),
    )

    return SuggestTagsOut(
        manager_action_id=manager_action_id, proposals=proposals
    )


# ── /apply_tags ───────────────────────────────────────────────────────


class TagProposalIn(BaseModel):
    proposal_index: int = Field(..., ge=0)
    action: Literal["accept", "edit", "reject"]
    edited_name: str | None = None
    edited_kind: str | None = None
    reject_reason: str | None = None


class ApplyTagsIn(BaseModel):
    manager_action_id: UUID
    decisions: list[TagProposalIn]


class ApplyTagsOut(BaseModel):
    tag_ids: list[UUID]
    summary: dict[str, int]


def _coerce_kind(kind: str | None, default: str = "topic") -> str:
    """Map unknown / blank kinds back to the schema default."""
    if not kind:
        return default
    k = kind.strip().lower()
    return k if k in _ALLOWED_KINDS else default


@router.post(
    "/api/artifacts/{artifact_id}/apply_tags", response_model=ApplyTagsOut
)
async def apply_tags(
    artifact_id: UUID,
    body: ApplyTagsIn,
    user: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> ApplyTagsOut:
    artifact = await _load_artifact(session, artifact_id)

    # Pull the prior proposals from the manager_action row's output JSON.
    action = (
        await session.execute(
            text(
                """
                select output from public.manager_actions
                where id = cast(:aid as uuid)
                  and project_id = cast(:pid as uuid)
                  and action_type = 'tag_suggestion'
                """
            ),
            {
                "aid": str(body.manager_action_id),
                "pid": str(artifact["project_id"]),
            },
        )
    ).first()
    if action is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="manager_action not found.",
        )

    # manager_actions.output is stored as `{"content": "<json string>"}`.
    # Robust to either pre-decoded jsonb or a raw text fallback.
    raw_output = action[0]
    try:
        if isinstance(raw_output, dict):
            inner = raw_output.get("content")
        else:
            outer = json.loads(raw_output) if raw_output else {}
            inner = outer.get("content") if isinstance(outer, dict) else None
        original = json.loads(inner) if isinstance(inner, str) else (inner or {})
    except Exception:
        original = {}

    original_proposals: list[dict[str, Any]] = (
        original.get("proposals") or []
        if isinstance(original, dict)
        else []
    )

    tag_ids: list[UUID] = []
    summary = {"accepted": 0, "edited": 0, "rejected": 0}
    verdict_records: list[dict[str, Any]] = []

    for decision in body.decisions:
        proposal = (
            original_proposals[decision.proposal_index]
            if 0 <= decision.proposal_index < len(original_proposals)
            else None
        )
        if proposal is None:
            # The proposal index is out of range — record a rejected-shape
            # verdict so the feedback loop sees the noise, but don't 4xx.
            verdict_records.append(
                {
                    "proposal_index": decision.proposal_index,
                    "action": "reject",
                    "reason": "proposal_index out of range",
                }
            )
            summary["rejected"] += 1
            continue

        if decision.action == "reject":
            summary["rejected"] += 1
            verdict_records.append(
                {
                    "proposal_index": decision.proposal_index,
                    "proposed_name": proposal.get("tag_name"),
                    "proposed_kind": proposal.get("kind"),
                    "action": "reject",
                    "reason": decision.reject_reason,
                }
            )
            continue

        if decision.action == "edit":
            name = (decision.edited_name or proposal.get("tag_name") or "").strip()
            kind = _coerce_kind(
                decision.edited_kind or proposal.get("kind"), default="topic"
            )
        else:
            name = (proposal.get("tag_name") or "").strip()
            kind = _coerce_kind(proposal.get("kind"), default="topic")

        if not name:
            # Defensive — refuse to insert an empty tag name even though
            # NOT NULL would catch it. Record as a reject in the audit.
            summary["rejected"] += 1
            verdict_records.append(
                {
                    "proposal_index": decision.proposal_index,
                    "proposed_name": proposal.get("tag_name"),
                    "action": "reject",
                    "reason": "empty tag name after edit",
                }
            )
            continue

        # Idempotent tag upsert: ON CONFLICT on the (project_id, name)
        # unique index returns the existing id, and refreshes the kind if
        # the caller's edit changed it. The empty-on-conflict-DO-NOTHING
        # form does NOT return the existing row, so we use DO UPDATE.
        tag_row = (
            await session.execute(
                text(
                    """
                    insert into public.tags (project_id, name, kind, created_by)
                    values (cast(:pid as uuid), :name, :kind, cast(:uid as uuid))
                    on conflict (project_id, name) do update
                      set kind = excluded.kind
                    returning id
                    """
                ),
                {
                    "pid": str(artifact["project_id"]),
                    "name": name,
                    "kind": kind,
                    "uid": str(user.id),
                },
            )
        ).first()
        if tag_row is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to upsert tag.",
            )
        tag_id = UUID(str(tag_row[0]))

        # Idempotent link: artifact_tags PK is (artifact_id, tag_id).
        await session.execute(
            text(
                """
                insert into public.artifact_tags (artifact_id, tag_id)
                values (cast(:aid as uuid), cast(:tid as uuid))
                on conflict (artifact_id, tag_id) do nothing
                """
            ),
            {"aid": str(artifact_id), "tid": str(tag_id)},
        )
        tag_ids.append(tag_id)

        if decision.action == "edit":
            summary["edited"] += 1
        else:
            summary["accepted"] += 1

        verdict_records.append(
            {
                "proposal_index": decision.proposal_index,
                "action": decision.action,
                "original": {
                    "tag_name": proposal.get("tag_name"),
                    "kind": proposal.get("kind"),
                },
                "final": {"tag_name": name, "kind": kind, "tag_id": str(tag_id)},
            }
        )

    overall_accepted = (summary["accepted"] + summary["edited"]) > 0

    await session.execute(
        text(
            """
            update public.manager_actions
              set accepted_by_human = :acc,
                  human_feedback = cast(:fb as text)
              where id = cast(:aid as uuid)
            """
        ),
        {
            "acc": overall_accepted,
            "fb": json.dumps(
                {"summary": summary, "decisions": verdict_records},
                ensure_ascii=False,
            ),
            "aid": str(body.manager_action_id),
        },
    )

    logger.info(
        "tag_suggestion.apply artifact=%s accepted=%d edited=%d rejected=%d",
        artifact_id,
        summary["accepted"],
        summary["edited"],
        summary["rejected"],
    )

    return ApplyTagsOut(tag_ids=tag_ids, summary=summary)
