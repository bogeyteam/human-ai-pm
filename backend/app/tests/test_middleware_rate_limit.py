"""Tests for the AI-endpoint rate limiter (`app/middleware/rate_limit.py`).

We test the bucket logic and path matcher directly — not via TestClient —
to keep the suite fast. Time is monkeypatched via `time.monotonic` so the
sliding-window math is deterministic and instant.
"""

from __future__ import annotations

import pytest

from app.middleware import rate_limit


@pytest.fixture(autouse=True)
def _clear_counters():
    """Bucket state is module-global — wipe it between tests."""
    rate_limit._COUNTERS.clear()
    rate_limit._WORKSPACE_CACHE.clear()
    yield
    rate_limit._COUNTERS.clear()
    rate_limit._WORKSPACE_CACHE.clear()


@pytest.fixture
def fake_clock(monkeypatch):
    """Replace time.monotonic() in the rate_limit module with a controllable clock."""
    state = {"now": 1000.0}

    def _now():
        return state["now"]

    monkeypatch.setattr(rate_limit.time, "monotonic", _now)

    def advance(seconds: float):
        state["now"] += seconds

    return advance


# ── _matches_ai_endpoint ───────────────────────────────────────────────


def test_matcher_recognizes_generate_tasks():
    assert rate_limit._matches_ai_endpoint(
        "POST", "/api/projects/abc-123/generate_tasks"
    )


def test_matcher_recognizes_optimizer_run():
    assert rate_limit._matches_ai_endpoint(
        "POST", "/api/projects/abc-123/optimizer/run"
    )


def test_matcher_recognizes_meetings_endpoints():
    assert rate_limit._matches_ai_endpoint("POST", "/api/meetings/m1/pre_brief")
    assert rate_limit._matches_ai_endpoint("POST", "/api/meetings/m1/post_summary")


def test_matcher_skips_persist_tasks_cheap_endpoint():
    """persist_* does not hit the LLM and must NOT count against the budget."""
    assert not rate_limit._matches_ai_endpoint(
        "POST", "/api/projects/abc-123/persist_tasks"
    )


def test_matcher_skips_get_methods():
    assert not rate_limit._matches_ai_endpoint(
        "GET", "/api/projects/abc-123/generate_tasks"
    )


def test_matcher_skips_unrelated_paths():
    assert not rate_limit._matches_ai_endpoint("POST", "/api/healthz")
    assert not rate_limit._matches_ai_endpoint("POST", "/api/projects/abc-123")


# ── _hit (per-scope sliding-window counter) ────────────────────────────


def test_hit_under_limit_returns_none(fake_clock):
    for _ in range(9):
        assert rate_limit._hit("user", "u1", window_s=60, limit=10) is None


def test_hit_at_limit_returns_retry_after(fake_clock):
    for _ in range(10):
        assert rate_limit._hit("user", "u1", window_s=60, limit=10) is None
    # 11th hit in the window: rejected.
    retry = rate_limit._hit("user", "u1", window_s=60, limit=10)
    assert retry is not None
    assert retry >= 1


def test_hit_resets_after_window_expires(fake_clock):
    """Hits older than window_s are evicted from the bucket."""
    for _ in range(10):
        rate_limit._hit("user", "u1", window_s=60, limit=10)
    # Advance past the window.
    fake_clock(61.0)
    # First hit in the new window must pass.
    assert rate_limit._hit("user", "u1", window_s=60, limit=10) is None


def test_workspace_limit_independent_of_user_scope(fake_clock):
    """Workspace-scoped bucket is keyed separately from user-scoped bucket."""
    # Hit user bucket up to 10.
    for _ in range(10):
        rate_limit._hit("user", "u1", window_s=60, limit=10)
    # Workspace bucket starts fresh — 1st hit must pass.
    assert rate_limit._hit("workspace", "ws1", window_s=60, limit=30) is None


def test_workspace_per_minute_cap_triggers_on_31st(fake_clock):
    """30 hits / 60s per workspace; 31st rejects regardless of user."""
    for _ in range(30):
        assert (
            rate_limit._hit("workspace", "ws1", window_s=60, limit=30) is None
        )
    retry = rate_limit._hit("workspace", "ws1", window_s=60, limit=30)
    assert retry is not None


def test_distinct_scope_values_have_independent_buckets(fake_clock):
    """Two different users in the same scope_type don't share a bucket."""
    for _ in range(10):
        rate_limit._hit("user", "u1", window_s=60, limit=10)
    # u2 is independent.
    assert rate_limit._hit("user", "u2", window_s=60, limit=10) is None
