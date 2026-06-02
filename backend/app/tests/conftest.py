"""Shared fixtures for the backend pytest suite.

Goals:
- No live DB. No live LLM calls. No network.
- Keep retry-related tests fast by neutralizing `asyncio.sleep` globally.
- Provide a single source of truth for the "fake AsyncSession" pattern so
  individual tests stay focused on behavior, not mock plumbing.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    """Replace `asyncio.sleep` with a no-op everywhere for the test session.

    Retry tests use a 1-second backoff on RateLimitError, so without this
    fixture each retry test would add ~1s to the suite. The behavior under
    test is "is sleep called?" — not "does sleep actually block?" — so a
    no-op is the right substitute.
    """

    async def _noop(_seconds: float, *args, **kwargs) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _noop)
    yield


def _make_execute_result(rows: list | None = None, scalar: object | None = None):
    """Build a SQLAlchemy-like Result object for AsyncSession.execute mocks."""
    result = MagicMock()
    result.all = MagicMock(return_value=rows or [])
    result.first = MagicMock(return_value=(rows[0] if rows else None))
    result.scalar_one = MagicMock(return_value=scalar)
    result.scalar_one_or_none = MagicMock(return_value=scalar)
    return result


@pytest.fixture
def fake_session():
    """An AsyncSession-shaped mock with an `execute` method that returns
    a configurable Result. Call `session.set_execute_result(rows=..., scalar=...)`
    or pass a side_effect to `session.execute` for multi-call scenarios.
    """
    session = AsyncMock()

    default = _make_execute_result()
    session.execute = AsyncMock(return_value=default)

    def set_result(rows: list | None = None, scalar: object | None = None) -> None:
        session.execute.return_value = _make_execute_result(rows=rows, scalar=scalar)

    session.set_execute_result = set_result  # type: ignore[attr-defined]
    return session


@pytest.fixture
def make_result():
    """Factory for building distinct Result mocks for multi-call execute side_effects."""
    return _make_execute_result
