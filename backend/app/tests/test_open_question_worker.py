"""M21 Open Question Engine — worker candidate shaping + pure-vector dedupe.

fake-session/monkeypatch tests (no DB/LLM). Pins: task candidates carry the
jsonb blast radius; decision candidates get the default {count:0} (must-fix);
dedupe is pure cosine math that drops already-queued / already-documented
candidates and keeps distant ones.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.workers import derive_open_questions as w
from app.workers.derive_open_questions import (
    _Candidate,
    _decision_candidates,
    _dedupe,
    _task_candidates,
)


def _result(rows):
    m = MagicMock()
    m.all = MagicMock(return_value=rows)
    m.first = MagicMock(return_value=(rows[0] if rows else None))
    return m


def _cand() -> _Candidate:
    return _Candidate(
        kind="task",
        source_id=uuid4(),
        headline="Prototype the Signature line",
        context="needs supplier",
        owner_id=None,
        blast_count=1,
        blast_radius={"released_task_ids": [], "count": 1},
        downstream_titles=[],
    )


async def test_task_candidates_carry_blast_radius_and_owner():
    task_id, dep_a, dep_b, owner = uuid4(), uuid4(), uuid4(), uuid4()
    row = (
        task_id,
        "Prototype Signature",
        "desc",
        "blocked",
        owner,
        2,
        [{"id": str(dep_a), "title": "Shoot"}, {"id": str(dep_b), "title": "Price"}],
    )
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_result([row]))

    cands = await _task_candidates(session, uuid4())
    assert len(cands) == 1
    c = cands[0]
    assert c.kind == "task"
    assert c.source_id == task_id
    assert c.owner_id == owner
    assert c.blast_count == 2
    assert c.blast_radius["count"] == 2
    assert str(dep_a) in c.blast_radius["released_task_ids"]
    assert c.downstream_titles == ["Shoot", "Price"]


async def test_decision_candidates_get_default_blast():
    did, dby = uuid4(), uuid4()
    row = (did, "How many units?", "500", dby, "2026-05-01T00:00:00+00:00")
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_result([row]))

    cands = await _decision_candidates(session, uuid4())
    assert len(cands) == 1
    c = cands[0]
    assert c.kind == "decision"
    assert c.owner_id == dby
    assert c.blast_count == 0
    assert c.blast_radius == {"released_task_ids": [], "count": 0}
    assert "review was due" in c.extra


async def test_dedupe_keeps_distant(monkeypatch):
    monkeypatch.setattr(w.llm, "embed", AsyncMock(return_value=[[0.1] * 4]))
    session = AsyncMock()
    # open_questions nearest = 0.9 (far), artifacts nearest = 0.9 (far) -> kept
    session.execute = AsyncMock(side_effect=[_result([(0.9,)]), _result([(0.9,)])])

    survivors = await _dedupe(session, uuid4(), uuid4(), [_cand()])
    assert len(survivors) == 1
    assert survivors[0].embedding == [0.1] * 4  # embedding carried forward to insert


async def test_dedupe_drops_already_queued(monkeypatch):
    monkeypatch.setattr(w.llm, "embed", AsyncMock(return_value=[[0.1] * 4]))
    session = AsyncMock()
    # open_questions nearest = 0.05 (< 0.18) -> dropped before the artifact query
    session.execute = AsyncMock(side_effect=[_result([(0.05,)])])

    survivors = await _dedupe(session, uuid4(), uuid4(), [_cand()])
    assert survivors == []


async def test_dedupe_drops_already_documented(monkeypatch):
    monkeypatch.setattr(w.llm, "embed", AsyncMock(return_value=[[0.1] * 4]))
    session = AsyncMock()
    # open_q far (0.9) but an artifact is near (0.05 < 0.22) -> answer already written
    session.execute = AsyncMock(side_effect=[_result([(0.9,)]), _result([(0.05,)])])

    survivors = await _dedupe(session, uuid4(), uuid4(), [_cand()])
    assert survivors == []
