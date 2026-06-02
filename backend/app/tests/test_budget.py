"""Tests for the per-workspace daily LLM budget cap (`app/llm/budget.py`).

`estimate_cost_usd` takes a `ModelChoice` (not a model name string) — the
spec hint about model-name strings reflects the wider contract, but the
real API operates on ROUTING entries. We exercise both Moonshot-priced
and Qwen-priced choices so the rate-sheet math is pinned.
"""

from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.llm import budget
from app.llm.budget import BudgetExceededError
from app.llm.routing import ROUTING

# ── estimate_cost_usd ──────────────────────────────────────────────────


def test_estimate_cost_for_moonshot_v1_128k():
    choice = ROUTING["task_generation"]  # moonshot-v1-128k, $2/M in, $4/M out
    cost = budget.estimate_cost_usd(choice, input_tokens=1_000, output_tokens=500)
    # 1000/1M * $2 + 500/1M * $4 = 0.002 + 0.002 = 0.004
    assert cost == pytest.approx(0.004)


def test_estimate_cost_for_qwen_embeddings():
    choice = ROUTING["embeddings"]  # text-embedding-v2, $0.07/M in, $0 out
    cost = budget.estimate_cost_usd(choice, input_tokens=5_000, output_tokens=0)
    # 5000/1M * $0.07 = 0.00035
    assert cost == pytest.approx(0.00035)


def test_estimate_cost_zero_tokens_is_zero():
    """Defensive: caller might pass zero (e.g. embed with empty batch).
    The result should be exactly 0.0, not negative or NaN.
    """
    choice = ROUTING["task_generation"]
    assert budget.estimate_cost_usd(choice, 0, 0) == 0.0


def test_estimate_cost_scales_linearly_with_input():
    choice = ROUTING["task_generation"]
    one = budget.estimate_cost_usd(choice, 1_000_000, 0)
    two = budget.estimate_cost_usd(choice, 2_000_000, 0)
    assert two == pytest.approx(one * 2)


# ── assert_budget ──────────────────────────────────────────────────────


async def test_assert_budget_passes_when_under_cap(fake_session, monkeypatch):
    monkeypatch.setattr(
        budget, "spent_today_usd", AsyncMock(return_value=0.10)
    )
    monkeypatch.setattr(
        budget, "workspace_budget_usd", AsyncMock(return_value=2.00)
    )
    # Should not raise.
    await budget.assert_budget(fake_session, uuid4(), estimated_cost_usd=0.05)


async def test_assert_budget_raises_when_over_cap(fake_session, monkeypatch):
    monkeypatch.setattr(
        budget, "spent_today_usd", AsyncMock(return_value=1.95)
    )
    monkeypatch.setattr(
        budget, "workspace_budget_usd", AsyncMock(return_value=2.00)
    )
    with pytest.raises(BudgetExceededError):
        await budget.assert_budget(
            fake_session, uuid4(), estimated_cost_usd=0.10
        )


async def test_assert_budget_raises_at_exact_overshoot(fake_session, monkeypatch):
    """Just one penny over the cap must still trip the guard."""
    monkeypatch.setattr(
        budget, "spent_today_usd", AsyncMock(return_value=2.00)
    )
    monkeypatch.setattr(
        budget, "workspace_budget_usd", AsyncMock(return_value=2.00)
    )
    with pytest.raises(BudgetExceededError):
        await budget.assert_budget(
            fake_session, uuid4(), estimated_cost_usd=0.01
        )
