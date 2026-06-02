"""Tests for M17 coaching — the audit_target gate.

The critical invariant: `audit_target="coaching"` MUST skip the
manager_actions INSERT entirely (the team-visible audit trail).
Coaching audit rows live in `coaching_sessions` (per-user RLS) and
are written by `app/api/coaching.py`, not by manager.generate().
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.llm import manager


def _fake_chat_response(content: str = '{"opener": "hi", "reflection_prompts": []}'):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5),
    )


async def test_audit_target_coaching_skips_manager_actions_insert(monkeypatch, fake_session):
    """Coaching path must not touch manager_actions — that table is workspace-public."""

    async def fake_create(**_kwargs):
        return _fake_chat_response()

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda _c: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    await manager.generate(
        task_type="coaching_session",
        messages=manager.build_messages("s", "p", "q"),
        session=fake_session,
        project_id=uuid4(),
        workspace_id=uuid4(),
        audit_target="coaching",
    )

    # No execute() at all — budget assert is mocked, audit insert is skipped.
    fake_session.execute.assert_not_awaited()


async def test_audit_target_default_still_writes_manager_actions(monkeypatch, fake_session):
    """Regression: default audit_target='manager_actions' MUST keep working."""

    async def fake_create(**_kwargs):
        return _fake_chat_response('{"ok": true}')

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda _c: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    await manager.generate(
        task_type="task_generation",
        messages=manager.build_messages("s", "p", "q"),
        session=fake_session,
        project_id=uuid4(),
        workspace_id=uuid4(),
        # audit_target omitted — must default to "manager_actions"
    )

    fake_session.execute.assert_awaited_once()
    call_args = fake_session.execute.call_args
    assert "insert into public.manager_actions" in str(call_args.args[0]).lower()


async def test_audit_target_unknown_raises_valueerror(monkeypatch, fake_session):
    """Unknown audit_target must fail loudly — silent loss of audit is unacceptable."""

    async def fake_create(**_kwargs):
        return _fake_chat_response()

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda _c: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    with pytest.raises(ValueError):
        await manager.generate(
            task_type="task_generation",
            messages=manager.build_messages("s", "p", "q"),
            session=fake_session,
            project_id=uuid4(),
            workspace_id=uuid4(),
            audit_target="some_typo",
        )


async def test_audit_target_coaching_still_enforces_budget(monkeypatch, fake_session):
    """Privacy doesn't excuse the bill: workspace pays even when content is private."""

    budget_calls = []

    async def fake_assert(_session, workspace_id, _cost):
        budget_calls.append(workspace_id)

    async def fake_create(**_kwargs):
        return _fake_chat_response()

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda _c: fake_client)
    monkeypatch.setattr(manager.budget, "assert_budget", fake_assert)

    ws = uuid4()
    await manager.generate(
        task_type="coaching_session",
        messages=manager.build_messages("s", "p", "q"),
        session=fake_session,
        project_id=uuid4(),
        workspace_id=ws,
        audit_target="coaching",
    )

    assert budget_calls == [ws], "Budget check must run for coaching too"


def test_coaching_session_routing_exists():
    """Routing must include coaching_session → moonshot. Catches accidental removals."""
    from app.llm.routing import ROUTING

    assert "coaching_session" in ROUTING
    choice = ROUTING["coaching_session"]
    assert choice.provider == "moonshot"
