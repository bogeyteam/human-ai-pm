"""Token-bucket-ish rate limiter for LLM-consuming endpoints.

In-process counters (deque of timestamps per scope+window) — fine for the
single-Railway-replica deploy we run today. If we ever scale horizontally,
swap this for Redis without touching call sites.

Three limits enforced *only* on configured AI endpoints:
  * 10 req / 60s per user_id
  * 30 req / 60s per workspace_id
  * 100 req / 3600s per workspace_id

Cheap endpoints (e.g. /persist_tasks) are intentionally NOT in the matcher
list — they don't hit the LLM, so they shouldn't burn the budget.
"""

from __future__ import annotations

import logging
import re
import time
from collections import defaultdict, deque
from typing import Final
from uuid import UUID

import jwt
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.db import session_scope
from app.settings import get_settings

logger = logging.getLogger(__name__)


# ── AI endpoints subject to rate limiting ────────────────────────────────────
# (method, compiled-regex-on-path). Matches templated paths — `{id}` becomes
# `[^/]+`. /persist_tasks is intentionally excluded (no LLM call).
_AI_ENDPOINTS: Final[list[tuple[str, re.Pattern[str]]]] = [
    ("POST", re.compile(r"^/api/projects/[^/]+/generate_tasks/?$")),
    ("POST", re.compile(r"^/api/projects/[^/]+/optimizer/run/?$")),
    ("POST", re.compile(r"^/api/projects/[^/]+/discover/?$")),
    ("POST", re.compile(r"^/api/meetings/[^/]+/pre_brief/?$")),
    ("POST", re.compile(r"^/api/meetings/[^/]+/post_summary/?$")),
    # M17 — coaching is LLM-backed, same per-user cap as other AI routes.
    # /rate is intentionally NOT here — it's a trivial DB update with no
    # LLM call, blocking it would only hurt UX.
    ("POST", re.compile(r"^/api/coaching/start/?$")),
    ("POST", re.compile(r"^/api/coaching/[^/]+/close/?$")),
    # M20 — tag suggestion hits the LLM. /apply_tags is intentionally NOT
    # here — it's a DB-only upsert, blocking it would only hurt UX.
    ("POST", re.compile(r"^/api/artifacts/[^/]+/suggest_tags/?$")),
    # M21 — daily brief hits the LLM. /daily_brief/feedback and /insights are
    # DB-only, so they're intentionally excluded.
    ("POST", re.compile(r"^/api/projects/[^/]+/daily_brief/?$")),
]


def _matches_ai_endpoint(method: str, path: str) -> bool:
    for m, pattern in _AI_ENDPOINTS:
        if m == method and pattern.match(path):
            return True
    return False


# ── Workspace lookup cache: user_id → (workspace_id, expires_at) ─────────────
_WORKSPACE_CACHE: dict[str, tuple[UUID | None, float]] = {}
_WORKSPACE_CACHE_TTL_S: Final[float] = 60.0


def _cache_get(user_id: str) -> UUID | None | object:
    """Returns the cached workspace_id (which may be None), or a sentinel
    `_MISS` if there's no live entry. We distinguish "cached None" from
    "uncached" so we don't re-query for users with no workspace.
    """
    entry = _WORKSPACE_CACHE.get(user_id)
    if entry is None:
        return _MISS
    workspace_id, expires_at = entry
    if expires_at < time.monotonic():
        _WORKSPACE_CACHE.pop(user_id, None)
        return _MISS
    return workspace_id


_MISS: Final[object] = object()


def _cache_put(user_id: str, workspace_id: UUID | None) -> None:
    _WORKSPACE_CACHE[user_id] = (workspace_id, time.monotonic() + _WORKSPACE_CACHE_TTL_S)


async def _resolve_workspace_id(user_id: str) -> UUID | None:
    """Loose JWT decode gives us `sub` but rarely the workspace. Look up
    public.users once per (user, 60s) window.
    """
    cached = _cache_get(user_id)
    if cached is not _MISS:
        return cached  # type: ignore[return-value]
    workspace_id: UUID | None = None
    try:
        async with session_scope() as session:
            row = (
                await session.execute(
                    text("select workspace_id from public.users where id = :uid"),
                    {"uid": user_id},
                )
            ).first()
        if row is not None and row[0] is not None:
            workspace_id = UUID(str(row[0]))
    except Exception:  # noqa: BLE001 — DB hiccups must not block requests.
        # Fail-open: skip the workspace cap rather than rejecting traffic
        # because pg is briefly unhappy. The user-level cap still applies.
        # Log it so a *sustained* outage (which silently disables the
        # per-workspace daily $ cap) is visible rather than invisible.
        logger.warning(
            "rate_limit: workspace lookup failed for user=%s; "
            "skipping workspace budget cap for this request (fail-open).",
            user_id,
            exc_info=True,
        )
        return None
    _cache_put(user_id, workspace_id)
    return workspace_id


def _decode_loose(authorization: str | None) -> str | None:
    """Pull `sub` from a Bearer JWT without verifying. Mirrors logging mw."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None
    try:
        claims = jwt.decode(
            token,
            options={"verify_signature": False, "verify_aud": False, "verify_exp": False},
        )
    except Exception:  # noqa: BLE001
        return None
    sub = claims.get("sub")
    return str(sub) if sub else None


# ── Counters ─────────────────────────────────────────────────────────────────
# (scope_type, scope_value, window_s) → deque[timestamp]
_COUNTERS: dict[tuple[str, str, int], deque[float]] = defaultdict(deque)


def _hit(scope_type: str, scope_value: str, window_s: int, limit: int) -> int | None:
    """Record a hit and return None if under limit, else seconds-until-retry."""
    now = time.monotonic()
    key = (scope_type, scope_value, window_s)
    bucket = _COUNTERS[key]
    cutoff = now - window_s
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        retry_after = max(1, int(window_s - (now - bucket[0])))
        return retry_after
    bucket.append(now)
    return None


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):  # type: ignore[override]
        if not _matches_ai_endpoint(request.method, request.url.path):
            return await call_next(request)

        settings = get_settings()
        user_limit = settings.rate_limit_user_per_min
        ws_min_limit = settings.rate_limit_workspace_per_min
        ws_hour_limit = settings.rate_limit_workspace_per_hour

        user_id = _decode_loose(request.headers.get("authorization"))

        # No identifiable user → let it through; auth dependency will 401.
        # We don't want to mask auth failures as rate-limit failures.
        if not user_id:
            return await call_next(request)

        # Per-user / minute
        retry = _hit("user", user_id, 60, user_limit)
        if retry is not None:
            return _too_many(retry)

        workspace_id = await _resolve_workspace_id(user_id)
        if workspace_id is not None:
            ws_key = str(workspace_id)
            retry = _hit("workspace", ws_key, 60, ws_min_limit)
            if retry is not None:
                return _too_many(retry)
            retry = _hit("workspace", ws_key, 3600, ws_hour_limit)
            if retry is not None:
                return _too_many(retry)

        return await call_next(request)


def _too_many(retry_after_s: int) -> Response:
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded. Try again in {retry_after_s} seconds."},
        headers={"Retry-After": str(retry_after_s)},
    )
