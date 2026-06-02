"""Cross-task Info Discovery worker.

Pure function `run_discovery(session, project_id, workspace_id)` so it can be
invoked from:
  - the `/api/projects/:id/discover` endpoint (M6),
  - a scheduled scan,
  - a "task done" trigger.

Algorithm:
  1. Embed any artifacts in this project that lack an embedding.
  2. Pull active (non-done, non-dropped) tasks and embed their titles+descriptions.
  3. For each artifact, find top-K similar active tasks via pgvector cosine.
  4. Filter out pairs already linked or previously dismissed.
  5. Pass surviving candidates to the LLM with prior feedback context.
  6. Persist genuinely useful findings to public.findings.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import manager as llm
from app.llm.prompts import load as load_prompt

# Max artifact-task pairs we let through to the LLM per run. Caps both
# token use and the chance of spammy findings.
MAX_CANDIDATES = 8
SIMILARITY_THRESHOLD = 0.55  # cosine distance < this counts as "similar enough"
TOP_K_PER_ARTIFACT = 3

# Qwen text-embedding-v2 caps inputs at 2048 tokens. Chinese chars are ~1
# token, English ~0.25. ~3500 chars keeps even pure-Chinese inputs safely
# under the limit with margin for tokenizer overhead.
EMBED_CHUNK_CHARS = 3500
# Hard ceiling on chunks per artifact — a 1MB markdown file shouldn't blow
# up the budget. 8 chunks ≈ 28k chars, covers the long tail well.
MAX_CHUNKS_PER_ARTIFACT = 8


def _chunk_text(text: str, max_chars: int = EMBED_CHUNK_CHARS) -> list[str]:
    """Split text at paragraph boundaries, falling back to hard char splits
    when a single paragraph exceeds max_chars."""
    if len(text) <= max_chars:
        return [text or " "]

    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for paragraph in text.split("\n\n"):
        para_len = len(paragraph) + 2
        # If the running buffer + this paragraph would overflow, flush.
        if current_len + para_len > max_chars and current:
            chunks.append("\n\n".join(current))
            current = []
            current_len = 0
        # Single oversize paragraph — hard-split by char count.
        if para_len > max_chars:
            remaining = paragraph
            while len(remaining) > max_chars:
                chunks.append(remaining[:max_chars])
                remaining = remaining[max_chars:]
            if remaining:
                current.append(remaining)
                current_len += len(remaining)
        else:
            current.append(paragraph)
            current_len += para_len

    if current:
        chunks.append("\n\n".join(current))
    return chunks[:MAX_CHUNKS_PER_ARTIFACT]


def _mean_pool(vectors: list[list[float]]) -> list[float]:
    """Average a list of vectors and re-normalize to unit length so cosine
    distance comparisons stay well-behaved against single-chunk embeddings."""
    if not vectors:
        raise ValueError("Cannot mean-pool empty list")
    if len(vectors) == 1:
        return vectors[0]
    dim = len(vectors[0])
    pooled = [sum(v[i] for v in vectors) / len(vectors) for i in range(dim)]
    norm = sum(x * x for x in pooled) ** 0.5
    if norm == 0:
        return pooled
    return [x / norm for x in pooled]


@dataclass(frozen=True, slots=True)
class _ArtifactRow:
    id: UUID
    title: str
    content: str
    task_id: UUID | None


@dataclass(frozen=True, slots=True)
class _TaskRow:
    id: UUID
    title: str
    description: str
    status: str
    owner_id: UUID | None


async def _embed_missing_artifacts(
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
) -> None:
    rows = (
        await session.execute(
            text(
                """
                select id, coalesce(title, '') || E'\\n' || coalesce(content, '') as body
                from public.artifacts
                where project_id = :pid
                  and embeddings is null
                  and (title is not null or content is not null)
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()
    if not rows:
        return

    # Build (artifact_id, chunks) tuples — long docs get split before embedding.
    artifact_chunks: list[tuple[UUID, list[str]]] = []
    for artifact_id, body in rows:
        chunks = _chunk_text(body or " ")
        artifact_chunks.append((UUID(str(artifact_id)), chunks))

    # Flatten chunks for a batched embed call, then group results back.
    flat_texts: list[str] = []
    flat_owners: list[UUID] = []
    for art_id, chunks in artifact_chunks:
        for c in chunks:
            flat_texts.append(c)
            flat_owners.append(art_id)

    vectors = await llm.embed(texts=flat_texts, session=session, workspace_id=workspace_id)

    grouped: dict[UUID, list[list[float]]] = {}
    for art_id, vec in zip(flat_owners, vectors, strict=True):
        grouped.setdefault(art_id, []).append(vec)

    for art_id, vecs in grouped.items():
        pooled = _mean_pool(vecs)
        await session.execute(
            text("update public.artifacts set embeddings = cast(:v as vector) where id = :id"),
            {"v": str(pooled), "id": str(art_id)},
        )


async def _active_tasks(session: AsyncSession, project_id: UUID) -> list[_TaskRow]:
    rows = (
        await session.execute(
            text(
                """
                select id, title, coalesce(description, ''), status, owner_id
                from public.tasks
                where project_id = :pid
                  and status in ('backlog','ready','in_progress','blocked')
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()
    return [
        _TaskRow(
            id=UUID(str(r[0])),
            title=r[1],
            description=r[2],
            status=r[3],
            owner_id=UUID(str(r[4])) if r[4] else None,
        )
        for r in rows
    ]


async def _candidate_pairs(
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
    active_tasks: list[_TaskRow],
) -> list[tuple[_ArtifactRow, _TaskRow, float]]:
    """For each active task, find top-K similar artifacts (cosine distance)."""
    if not active_tasks:
        return []
    task_texts = [f"{t.title}\n{t.description}" for t in active_tasks]
    task_vecs = await llm.embed(texts=task_texts, session=session, workspace_id=workspace_id)

    pairs: list[tuple[_ArtifactRow, _TaskRow, float]] = []
    seen_ids: set[tuple[UUID | None, UUID]] = set()

    for task, tvec in zip(active_tasks, task_vecs, strict=True):
        rows = (
            await session.execute(
                text(
                    """
                    select id, title, coalesce(content, ''), task_id,
                           (embeddings <=> cast(:v as vector)) as dist
                    from public.artifacts
                    where project_id = :pid
                      and embeddings is not null
                      and (task_id is null or task_id <> :self_task)
                    order by embeddings <=> cast(:v as vector)
                    limit :k
                    """
                ),
                {
                    "v": str(tvec),
                    "pid": str(project_id),
                    "self_task": str(task.id),
                    "k": TOP_K_PER_ARTIFACT,
                },
            )
        ).all()
        for r in rows:
            dist = float(r[4] or 1.0)
            if dist > SIMILARITY_THRESHOLD:
                continue
            artifact = _ArtifactRow(
                id=UUID(str(r[0])),
                title=r[1] or "",
                content=(r[2] or "")[:1000],
                task_id=UUID(str(r[3])) if r[3] else None,
            )
            key = (artifact.task_id, task.id)
            if key in seen_ids:
                continue
            seen_ids.add(key)
            pairs.append((artifact, task, dist))

    pairs.sort(key=lambda p: p[2])
    return pairs[:MAX_CANDIDATES]


async def _drop_already_linked(
    session: AsyncSession,
    project_id: UUID,
    pairs: list[tuple[_ArtifactRow, _TaskRow, float]],
) -> list[tuple[_ArtifactRow, _TaskRow, float]]:
    if not pairs:
        return []
    rows = (
        await session.execute(
            text(
                """
                select source_artifact_id, target_task_id
                from public.findings
                where project_id = :pid
                """
            ),
            {"pid": str(project_id)},
        )
    ).all()
    existing = {(UUID(str(r[0])) if r[0] else None, UUID(str(r[1]))) for r in rows}
    return [(a, t, d) for (a, t, d) in pairs if (a.id, t.id) not in existing]


async def _build_feedback_block(session: AsyncSession, project_id: UUID) -> str:
    fb_rows = await llm.recent_feedback(
        session, project_id, action_type="info_discovery", limit=15
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
        lines.append("\n## Past dismissed findings")
        lines.extend(f"- {d}" for d in dismissed[:8])
    if accepted:
        lines.append("\n## Recently accepted findings")
        lines.extend(f"- {a}" for a in accepted[:5])
    return "\n".join(lines)


async def run_discovery(
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
) -> dict[str, Any]:
    """Run one discovery pass. Returns {finding_ids, candidate_count, written}."""
    await _embed_missing_artifacts(session, project_id, workspace_id)

    active = await _active_tasks(session, project_id)
    if not active:
        return {"finding_ids": [], "candidate_count": 0, "written": 0}

    pairs = await _candidate_pairs(session, project_id, workspace_id, active)
    pairs = await _drop_already_linked(session, project_id, pairs)
    if not pairs:
        return {"finding_ids": [], "candidate_count": 0, "written": 0}

    # Group by artifact for the LLM call (lets the model see all related
    # tasks at once and pick the best target, or skip).
    #
    # M20: surface each artifact's tags as a soft signal alongside the
    # content. Feature-additive — artifacts with no tags emit no extra
    # line, so existing discovery behavior is unchanged for the long tail
    # of un-tagged artifacts.
    artifacts_block: list[str] = []
    artifact_order: list[_ArtifactRow] = []
    for a, _t, _d in pairs:
        if a not in artifact_order:
            artifact_order.append(a)
            tag_rows = (
                await session.execute(
                    text(
                        """
                        select t.name, t.kind
                        from public.tags t
                        join public.artifact_tags at on t.id = at.tag_id
                        where at.artifact_id = cast(:aid as uuid)
                        order by t.name
                        """
                    ),
                    {"aid": str(a.id)},
                )
            ).all()
            tag_line = (
                "\nTags: "
                + ", ".join(f"{r[0]} ({r[1]})" for r in tag_rows)
                if tag_rows
                else ""
            )
            artifacts_block.append(
                f"### [artifact {len(artifact_order) - 1}] {a.title}"
                f"{tag_line}\n{a.content}"
            )

    tasks_block: list[str] = []
    task_order: list[_TaskRow] = []
    for _a, t, _d in pairs:
        if t not in task_order:
            task_order.append(t)
            tasks_block.append(
                f"- [task {len(task_order) - 1}] [{t.status}] {t.title} — {t.description[:300]}"
            )

    user_query = (
        "## Candidate artifacts\n"
        + "\n".join(artifacts_block)
        + "\n\n## Active tasks\n"
        + "\n".join(tasks_block)
    )

    stable_system = load_prompt("info_discovery_system")
    project_state = await _project_state_snapshot(session, project_id)
    feedback_block = await _build_feedback_block(session, project_id)

    messages = llm.build_messages(
        stable_system=stable_system,
        project_state=project_state + feedback_block,
        user_query=user_query,
    )

    content, _usage = await llm.generate(
        task_type="info_discovery",
        messages=messages,
        session=session,
        project_id=project_id,
        workspace_id=workspace_id,
        response_format={"type": "json_object"},
        temperature=0.2,
        max_tokens=2048,
        audit_input={
            "candidate_artifact_count": len(artifact_order),
            "candidate_task_count": len(task_order),
        },
    )

    # Find the manager_action row we just wrote.
    action_row = (
        await session.execute(
            text(
                """
                select id from public.manager_actions
                where project_id = :pid and action_type = 'info_discovery'
                order by created_at desc limit 1
                """
            ),
            {"pid": str(project_id)},
        )
    ).first()
    assert action_row is not None
    manager_action_id = UUID(str(action_row[0]))

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return {"finding_ids": [], "candidate_count": len(pairs), "written": 0}

    finding_ids: list[str] = []
    for raw in parsed.get("useful_findings") or []:
        try:
            a_idx = int(raw["source_artifact_index"])
            t_idx = int(raw["target_task_index"])
            how = (raw.get("how_to_use") or "").strip()
        except (KeyError, TypeError, ValueError):
            continue
        if not how:
            continue
        if not (0 <= a_idx < len(artifact_order)) or not (0 <= t_idx < len(task_order)):
            continue
        artifact = artifact_order[a_idx]
        task = task_order[t_idx]

        inserted = (
            await session.execute(
                text(
                    """
                    insert into public.findings
                      (project_id, source_artifact_id, source_task_id,
                       target_task_id, target_owner_id, how_to_use, manager_action_id)
                    values
                      (:pid, :sa, :st, :tt, :owner, :how, :ma)
                    on conflict (source_artifact_id, target_task_id)
                      where source_artifact_id is not null
                      do nothing
                    returning id
                    """
                ),
                {
                    "pid": str(project_id),
                    "sa": str(artifact.id),
                    "st": str(artifact.task_id) if artifact.task_id else None,
                    "tt": str(task.id),
                    "owner": str(task.owner_id) if task.owner_id else None,
                    "how": how,
                    "ma": str(manager_action_id),
                },
            )
        ).first()
        if inserted is not None:
            finding_ids.append(str(inserted[0]))

    return {
        "finding_ids": finding_ids,
        "candidate_count": len(pairs),
        "written": len(finding_ids),
    }


async def _project_state_snapshot(session: AsyncSession, project_id: UUID) -> str:
    """Compact project state — same shape as generate.py but trimmed."""
    project = (
        await session.execute(
            text("select name, vision, current_stage from public.projects where id = :pid"),
            {"pid": str(project_id)},
        )
    ).first()
    assert project is not None
    return (
        f"# Project state snapshot\n"
        f"Name: {project[0]}\n"
        f"Vision: {project[1] or '—'}\n"
        f"Current stage: {project[2]}\n"
    )
