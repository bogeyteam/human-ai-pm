"""M21 Open Question Engine — respond + resolve API contract.

Direct route-function calls against a fake_session (no DB/LLM/network), mirroring
the test_tag_suggestion.py / findings style.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.questions import (
    QuestionResolveIn,
    QuestionRespondIn,
    resolve,
    respond,
)


def _result(rows):
    m = MagicMock()
    m.all = MagicMock(return_value=rows)
    m.first = MagicMock(return_value=(rows[0] if rows else None))
    return m


def _user():
    return SimpleNamespace(id=uuid4(), email="t@t", workspace_id=uuid4())


def _sql_of(call) -> str:
    return str(call.args[0]).lower()


async def test_respond_dismiss_without_reason_400():
    qid, pid, ma_id = uuid4(), uuid4(), uuid4()
    q_row = (qid, pid, ma_id, "Which supplier?", "open")
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[_result([q_row])])

    with pytest.raises(HTTPException) as exc:
        await respond(
            question_id=qid,
            body=QuestionRespondIn(action="dismiss"),
            user=_user(),
            session=session,
        )
    assert exc.value.status_code == 400


async def test_respond_accept_routes_and_records_verdict():
    qid, pid, ma_id = uuid4(), uuid4(), uuid4()
    q_row = (qid, pid, ma_id, "Which supplier?", "open")
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _result([q_row]),          # load question
            _result([]),               # update open_questions
            _result([(None, None)]),   # select manager_actions for verdict append
            _result([]),               # update manager_actions
        ]
    )

    out = await respond(
        question_id=qid,
        body=QuestionRespondIn(action="accept"),
        user=_user(),
        session=session,
    )
    assert out.status == "routed"

    # The manager_actions update must mark accepted_by_human True and store the verdict.
    ma_update = [
        c for c in session.execute.await_args_list
        if "update public.manager_actions" in _sql_of(c)
    ][-1]
    params = ma_update.args[1]
    assert params["acc"] is True
    fb = json.loads(params["fb"])
    assert fb["verdicts"][-1]["action"] == "accept"


async def test_resolve_decision_lands_gated_row_no_task_mutation():
    qid, pid, ma_id, source_task_id = uuid4(), uuid4(), uuid4(), uuid4()
    decision_id = uuid4()
    q_row = (qid, pid, ma_id, "Which supplier and MOQ?", source_task_id)
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _result([q_row]),              # load question
            _result([(decision_id,)]),     # insert decisions ... returning id
            _result([]),                   # update open_questions -> answered
            _result([(None, None)]),       # select manager_actions
            _result([]),                   # update manager_actions
        ]
    )

    out = await resolve(
        question_id=qid,
        body=QuestionResolveIn(answer_text="Supplier B, MOQ 500", land_as="decision"),
        user=_user(),
        session=session,
    )
    assert out.status == "answered"
    assert out.landed_kind == "decision"
    assert out.landed_id == decision_id

    sqls = [_sql_of(c) for c in session.execute.await_args_list]
    assert any("insert into public.decisions" in s for s in sqls)
    # advisory rule: resolving must NOT auto-mutate the blocked task graph.
    assert not any("update public.tasks" in s for s in sqls)


async def test_resolve_artifact_lands_decision_typed_artifact():
    qid, pid, ma_id, source_task_id = uuid4(), uuid4(), uuid4(), uuid4()
    artifact_id = uuid4()
    q_row = (qid, pid, ma_id, "What did the customer say?", source_task_id)
    session = AsyncMock()
    session.execute = AsyncMock(
        side_effect=[
            _result([q_row]),
            _result([(artifact_id,)]),     # insert artifacts ... returning id
            _result([]),                   # update open_questions
            _result([(None, None)]),
            _result([]),
        ]
    )

    out = await resolve(
        question_id=qid,
        body=QuestionResolveIn(answer_text="They want a gift-box option", land_as="artifact"),
        user=_user(),
        session=session,
    )
    assert out.landed_kind == "artifact"
    assert out.landed_id == artifact_id

    insert_call = [
        c for c in session.execute.await_args_list
        if "insert into public.artifacts" in _sql_of(c)
    ][0]
    assert insert_call.args[1]["tid"] == str(source_task_id)
    assert not any("update public.tasks" in _sql_of(c) for c in session.execute.await_args_list)
