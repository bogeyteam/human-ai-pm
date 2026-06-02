"""Tests for the LLM gateway (`app/llm/manager.py`).

These tests guard the prompt-caching contract, the feedback-loop SQL
shape, the single-retry policy, and the audit-row write that every
`generate()` call must perform. No live LLM calls.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import openai
import pytest

from app.llm import manager

# ── build_messages ─────────────────────────────────────────────────────


def test_build_messages_shape():
    msgs = manager.build_messages("STABLE", "STATE", "QUERY")
    assert len(msgs) == 3
    assert msgs[0] == {"role": "system", "content": "STABLE"}
    assert msgs[1] == {"role": "system", "content": "STATE"}
    assert msgs[2] == {"role": "user", "content": "QUERY"}


def test_build_messages_preserves_cache_order_with_extras():
    extras = [{"role": "assistant", "content": "prior"}]
    msgs = manager.build_messages("S", "P", "Q", extras=extras)
    # User message must remain LAST regardless of extras (cache-friendliness).
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "system"
    assert msgs[-1] == {"role": "user", "content": "Q"}
    assert {"role": "assistant", "content": "prior"} in msgs


# ── recent_feedback ────────────────────────────────────────────────────


async def test_recent_feedback_extracts_row_fields(fake_session):
    """Mock rows simulate what SQLAlchemy returns from .all()."""
    row_id = uuid4()
    created = datetime(2026, 5, 14, 12, 0, 0, tzinfo=UTC)
    fake_session.set_execute_result(
        rows=[
            (
                row_id,
                {"content": "..."},
                True,
                {"reason": "looks good"},
                created,
            )
        ]
    )
    project_id = uuid4()
    out = await manager.recent_feedback(fake_session, project_id, "task_generation")
    assert len(out) == 1
    item = out[0]
    assert item["id"] == str(row_id)
    assert item["accepted_by_human"] is True
    assert item["human_feedback"] == {"reason": "looks good"}
    assert item["created_at"] == created.isoformat()


async def test_recent_feedback_passes_correct_sql_params(fake_session):
    project_id = uuid4()
    fake_session.set_execute_result(rows=[])
    await manager.recent_feedback(
        fake_session, project_id, "backlog_optimizer", limit=5
    )
    fake_session.execute.assert_awaited_once()
    call_args = fake_session.execute.call_args
    params = call_args.args[1] if len(call_args.args) > 1 else call_args.kwargs
    assert params["pid"] == str(project_id)
    assert params["atype"] == "backlog_optimizer"
    assert params["limit"] == 5


async def test_recent_feedback_empty_when_no_rows(fake_session):
    fake_session.set_execute_result(rows=[])
    out = await manager.recent_feedback(fake_session, uuid4(), "task_generation")
    assert out == []


# ── _with_one_retry ────────────────────────────────────────────────────


def _rate_limit_error() -> openai.RateLimitError:
    return openai.RateLimitError(
        "throttled",
        response=httpx.Response(
            429, request=httpx.Request("POST", "https://example.test")
        ),
        body=None,
    )


def _connection_error() -> openai.APIConnectionError:
    return openai.APIConnectionError(
        request=httpx.Request("POST", "https://example.test")
    )


def _bad_request_error() -> openai.BadRequestError:
    return openai.BadRequestError(
        "bad input",
        response=httpx.Response(
            400, request=httpx.Request("POST", "https://example.test")
        ),
        body=None,
    )


async def test_with_one_retry_success_path_calls_once():
    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        return "ok"

    out = await manager._with_one_retry(factory, op_name="t")
    assert out == "ok"
    assert calls == 1


async def test_with_one_retry_recovers_after_rate_limit():
    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _rate_limit_error()
        return "recovered"

    out = await manager._with_one_retry(factory, op_name="t")
    assert out == "recovered"
    assert calls == 2


async def test_with_one_retry_recovers_after_connection_error():
    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _connection_error()
        return "recovered"

    out = await manager._with_one_retry(factory, op_name="t")
    assert out == "recovered"
    assert calls == 2


async def test_with_one_retry_reraises_after_second_failure():
    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        raise _rate_limit_error()

    with pytest.raises(openai.RateLimitError):
        await manager._with_one_retry(factory, op_name="t")
    assert calls == 2  # original + one retry, then re-raise


async def test_with_one_retry_does_not_retry_on_bad_request():
    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        raise _bad_request_error()

    with pytest.raises(openai.BadRequestError):
        await manager._with_one_retry(factory, op_name="t")
    assert calls == 1  # no retry — 4xx non-429 fails fast


async def test_with_one_retry_sleeps_on_rate_limit(monkeypatch):
    """The rate-limit branch must hit asyncio.sleep with the 1s backoff."""
    sleep_calls: list[float] = []

    async def fake_sleep(seconds):
        sleep_calls.append(seconds)

    # The autouse fixture already patched asyncio.sleep on the asyncio module,
    # but manager imports it as `from collections.abc import ...` and uses
    # `await asyncio.sleep(...)` via the imported module. Re-patch on the
    # manager module's view of asyncio to be explicit.
    monkeypatch.setattr(manager.asyncio, "sleep", fake_sleep)

    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _rate_limit_error()
        return "ok"

    await manager._with_one_retry(factory, op_name="t")
    assert sleep_calls == [1.0]


async def test_with_one_retry_no_sleep_on_connection_error(monkeypatch):
    sleep_calls: list[float] = []

    async def fake_sleep(seconds):
        sleep_calls.append(seconds)

    monkeypatch.setattr(manager.asyncio, "sleep", fake_sleep)

    calls = 0

    async def factory():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _connection_error()
        return "ok"

    await manager._with_one_retry(factory, op_name="t")
    assert sleep_calls == []  # connection errors retry without sleep


# ── generate() — model routing + audit row write ──────────────────────


def _fake_chat_response(content: str = "hello", in_toks: int = 10, out_toks: int = 5):
    """Build an object shaped like openai's ChatCompletion response."""
    return SimpleNamespace(
        choices=[
            SimpleNamespace(message=SimpleNamespace(content=content))
        ],
        usage=SimpleNamespace(prompt_tokens=in_toks, completion_tokens=out_toks),
    )


async def test_generate_routes_to_correct_model(monkeypatch, fake_session):
    """task_generation should resolve to Moonshot's moonshot-v1-128k."""
    captured: dict = {}

    async def fake_create(**kwargs):
        captured.update(kwargs)
        return _fake_chat_response()

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda choice: fake_client)
    # Budget check passes silently.
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    content, usage = await manager.generate(
        task_type="task_generation",
        messages=manager.build_messages("s", "p", "q"),
        session=fake_session,
        project_id=uuid4(),
        workspace_id=uuid4(),
    )

    assert content == "hello"
    assert captured["model"] == "moonshot-v1-128k"
    assert usage["model"] == "moonshot-v1-128k"
    assert usage["input_tokens"] == 10
    assert usage["output_tokens"] == 5


async def test_generate_writes_manager_actions_audit_row(monkeypatch, fake_session):
    async def fake_create(**kwargs):
        return _fake_chat_response()

    fake_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=fake_create))
    )
    monkeypatch.setattr(manager, "_client_for", lambda choice: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    project_id = uuid4()
    await manager.generate(
        task_type="task_generation",
        messages=manager.build_messages("s", "p", "q"),
        session=fake_session,
        project_id=project_id,
        workspace_id=uuid4(),
    )

    # Exactly one execute() for the audit row.
    fake_session.execute.assert_awaited_once()
    call_args = fake_session.execute.call_args
    sql_obj = call_args.args[0]
    params = call_args.args[1]
    assert "insert into public.manager_actions" in str(sql_obj).lower()
    assert params["pid"] == str(project_id)
    assert params["atype"] == "task_generation"


# ── embed() — chunking + dim guard ────────────────────────────────────


def _fake_embed_response(n: int, dim: int = 1536):
    return SimpleNamespace(
        data=[SimpleNamespace(embedding=[0.0] * dim) for _ in range(n)]
    )


async def test_embed_batches_long_input(monkeypatch, fake_session):
    """embed() chunks at BATCH=25. 60 inputs ⇒ 3 client calls (25+25+10)."""
    call_batch_sizes: list[int] = []

    async def fake_create(model, input):
        call_batch_sizes.append(len(input))
        return _fake_embed_response(len(input))

    fake_client = SimpleNamespace(
        embeddings=SimpleNamespace(create=fake_create)
    )
    monkeypatch.setattr(manager, "_client_for", lambda choice: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    texts = [f"item {i}" for i in range(60)]
    out = await manager.embed(
        texts=texts, session=fake_session, workspace_id=uuid4()
    )

    assert len(out) == 60
    assert call_batch_sizes == [25, 25, 10]


async def test_embed_empty_input_is_no_op(monkeypatch, fake_session):
    """Empty list must not invoke the client at all."""

    def _no_client(_choice):
        raise AssertionError("client should not be built for empty input")

    monkeypatch.setattr(manager, "_client_for", _no_client)
    out = await manager.embed(texts=[], session=fake_session, workspace_id=uuid4())
    assert out == []


async def test_embed_raises_on_dim_mismatch(monkeypatch, fake_session):
    """Schema requires 1536-dim vectors. Anything else must fail loudly."""

    async def fake_create(model, input):
        return _fake_embed_response(len(input), dim=512)

    fake_client = SimpleNamespace(
        embeddings=SimpleNamespace(create=fake_create)
    )
    monkeypatch.setattr(manager, "_client_for", lambda choice: fake_client)
    monkeypatch.setattr(
        manager.budget, "assert_budget", AsyncMock(return_value=None)
    )

    with pytest.raises(RuntimeError, match="Embedding dim mismatch"):
        await manager.embed(
            texts=["hello"], session=fake_session, workspace_id=uuid4()
        )
