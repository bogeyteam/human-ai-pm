"""Unified LLM gateway. The Manager Agent's only entry point to models.

`generate()` and `embed()` are the only LLM calls anywhere in the codebase.
Every call:
  1. Resolves task_type → ModelChoice via routing.ROUTING.
  2. Checks per-workspace daily budget (design rule #5).
  3. Calls the provider SDK directly (Moonshot/Qwen via OpenAI-compatible
     endpoints; Anthropic via its own SDK).
  4. Persists one `manager_actions` row with input/output/usage so the
     feedback loop (design rule #2) and audit trail are guaranteed.

Prompt-caching shape (PRD §9.4 / design rule #6): callers should pass
messages as [stable_system, project_state_snapshot, user_query] so the
first two segments stay cache-eligible across calls in the same project.

Loop cap (design rule #3): callers MUST NOT exceed 3 model round-trips
without a human checkpoint. Enforce in the caller, not here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, cast
from uuid import UUID

import openai
from openai import AsyncOpenAI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm import budget
from app.llm.routing import EMBED_DIM, ROUTING, ModelChoice, TaskType
from app.settings import get_settings

logger = logging.getLogger(__name__)


# ── Transient-error retry helper ────────────────────────────────────
#
# Wraps a single SDK call with one retry on transient failures (5xx,
# 429, connect/read timeouts). Fail-fast on 4xx auth/validation errors.
# Loop cap (design rule #3) is unaffected — this is intra-call retry,
# not an agentic loop.


# Always-retry exception types (transport-layer / SDK-level transient).
_RETRY_EXC_TYPES: tuple[type[BaseException], ...] = (
    openai.APIConnectionError,  # wraps httpx ConnectError/ReadError/RemoteProtocolError
    openai.APITimeoutError,     # wraps httpx ReadTimeout/ConnectTimeout
    openai.InternalServerError, # HTTP 5xx
)


def _should_retry(exc: BaseException) -> tuple[bool, float]:
    """Decide whether an exception is retry-eligible, and how long to sleep.

    Returns (retry, sleep_seconds). 4xx other than 429 is never retried.
    """
    if isinstance(exc, _RETRY_EXC_TYPES):
        return True, 0.0
    if isinstance(exc, openai.RateLimitError):
        return True, 1.0  # 1s backoff per spec
    # Catch-all for other APIError subclasses keyed by status_code.
    if isinstance(exc, openai.APIError):
        status_code = getattr(exc, "status_code", None)
        if isinstance(status_code, int) and status_code >= 500:
            return True, 0.0
        return False, 0.0
    return False, 0.0


async def _with_one_retry[T](
    coro_factory: Callable[[], Awaitable[T]],
    *,
    op_name: str,
) -> T:
    """Call `coro_factory()` once; on transient failure, retry exactly once.

    `coro_factory` must be a zero-arg callable that returns a fresh awaitable
    each invocation (a coroutine can only be awaited once, so we re-build it).
    On second failure the original exception type propagates unchanged.
    """
    try:
        return await coro_factory()
    except BaseException as exc:  # noqa: BLE001 — narrowed by _should_retry
        retry, sleep_s = _should_retry(exc)
        if not retry:
            raise
        logger.warning(
            "llm.retry op=%s err=%s sleep=%.2fs",
            op_name,
            type(exc).__name__,
            sleep_s,
        )
        if sleep_s > 0:
            await asyncio.sleep(sleep_s)
        return await coro_factory()

# ── Provider clients ────────────────────────────────────────────────


def _moonshot_client() -> AsyncOpenAI:
    s = get_settings()
    if not s.moonshot_api_key:
        raise RuntimeError("MOONSHOT_API_KEY missing in .env")
    return AsyncOpenAI(api_key=s.moonshot_api_key, base_url=s.moonshot_base_url)


def _qwen_client() -> AsyncOpenAI:
    s = get_settings()
    if not s.qwen_api_key:
        raise RuntimeError("QWEN_API_KEY missing in .env")
    return AsyncOpenAI(api_key=s.qwen_api_key, base_url=s.qwen_base_url)


def _client_for(choice: ModelChoice) -> AsyncOpenAI:
    if choice.provider == "moonshot":
        return _moonshot_client()
    if choice.provider == "qwen":
        return _qwen_client()
    if choice.provider == "anthropic":
        # Defer until needed (V1 coaching). Anthropic has its own SDK
        # which is not strictly OpenAI-compatible.
        raise NotImplementedError("Anthropic path is V1 — coaching feature only.")
    raise ValueError(f"Unknown provider: {choice.provider}")


# ── Messages helpers ────────────────────────────────────────────────


def build_messages(
    stable_system: str,
    project_state: str,
    user_query: str,
    *,
    extras: Sequence[dict[str, str]] = (),
) -> list[dict[str, str]]:
    """Prompt-caching-friendly message shape (design rule #6).

    [stable_system] should be the unchanging persona + format prompt.
    [project_state] is the per-project snapshot (changes slowly).
    [user_query] is the per-call payload.
    """
    msgs: list[dict[str, str]] = [
        {"role": "system", "content": stable_system},
        {"role": "system", "content": project_state},
    ]
    msgs.extend(extras)
    msgs.append({"role": "user", "content": user_query})
    return msgs


# ── Core: generate() ────────────────────────────────────────────────


async def generate(
    *,
    task_type: TaskType,
    messages: list[dict[str, str]],
    session: AsyncSession,
    project_id: UUID,
    workspace_id: UUID,
    response_format: dict[str, Any] | None = None,
    temperature: float = 0.3,
    max_tokens: int = 4096,
    audit_input: dict[str, Any] | None = None,
    audit_target: str = "manager_actions",
) -> tuple[str, dict[str, Any]]:
    """Run a model call and persist it to manager_actions.

    Returns (content, usage_dict). usage_dict has input/output tokens
    and estimated_cost_usd.

    `audit_target` controls where the audit row lands:
      * "manager_actions" (default) — the standard team-visible audit
        row. Powers the feedback loop (design rule #2).
      * "coaching"        — M17 V1 coaching. The manager_actions INSERT
        is SKIPPED entirely; the caller is responsible for writing the
        private audit into coaching_sessions instead. Budget enforcement
        is unchanged — the workspace still pays even when the content
        is per-user-private.

    Note for callers: `project_id` is still required because the
    manager_actions row requires it. For coaching, pass any project_id
    in the user's workspace — it's never used since the INSERT is
    skipped. (Kept the signature shape stable rather than adding an
    Optional, so existing callers don't shift.)
    """
    choice = ROUTING[task_type]

    # Pessimistic pre-flight budget check (estimate full max_tokens).
    rough_input_tokens = sum(len(m["content"]) for m in messages) // 4  # ~4 chars/token
    projected_cost = budget.estimate_cost_usd(choice, rough_input_tokens, max_tokens)
    await budget.assert_budget(session, workspace_id, projected_cost)

    client = _client_for(choice)
    started = time.monotonic()
    kwargs: dict[str, Any] = {
        "model": choice.model,
        "messages": cast(list[Any], messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format is not None:
        kwargs["response_format"] = response_format

    resp = await _with_one_retry(
        lambda: client.chat.completions.create(**kwargs),
        op_name=f"{choice.provider}.chat",
    )
    latency_ms = int((time.monotonic() - started) * 1000)

    content = resp.choices[0].message.content or ""
    usage_in = resp.usage.prompt_tokens if resp.usage else rough_input_tokens
    usage_out = resp.usage.completion_tokens if resp.usage else 0
    cost = budget.estimate_cost_usd(choice, usage_in, usage_out)

    usage_dict = {
        "provider": choice.provider,
        "model": choice.model,
        "input_tokens": usage_in,
        "output_tokens": usage_out,
        "latency_ms": latency_ms,
        "estimated_cost_usd": round(cost, 6),
    }

    # Audit row. accepted_by_human stays NULL until user reviews
    # (design rule #2 — every output is feedback-looped).
    #
    # M17: coaching opts out of the team-visible manager_actions row via
    # audit_target="coaching". The caller (app/api/coaching.py) writes
    # the audit into the strict-per-user coaching_sessions table itself.
    if audit_target == "manager_actions":
        await session.execute(
            text(
                """
                insert into public.manager_actions (project_id, action_type, input_context, output)
                values (:pid, :atype, cast(:ctx as jsonb), cast(:out as jsonb))
                """
            ),
            {
                "pid": str(project_id),
                "atype": task_type,
                "ctx": json.dumps({"messages": messages, "usage": usage_dict, "audit": audit_input or {}}),
                "out": json.dumps({"content": content}),
            },
        )
    elif audit_target == "coaching":
        # Caller is responsible for persisting into coaching_sessions.
        # Nothing to do here. Budget was already enforced above.
        pass
    else:
        raise ValueError(
            f"Unknown audit_target: {audit_target!r}. "
            "Expected 'manager_actions' (default) or 'coaching'."
        )

    return content, usage_dict


# ── Core: embed() ───────────────────────────────────────────────────


async def embed(
    *,
    texts: str | list[str],
    session: AsyncSession,
    workspace_id: UUID,
) -> list[list[float]]:
    """Generate embeddings (PRD §9.3 — Qwen text-embedding-v2 by default).

    Cost is tiny but we still budget-check it so the cap is meaningful.
    """
    if isinstance(texts, str):
        texts = [texts]
    if not texts:
        return []

    choice = ROUTING["embeddings"]
    rough_tokens = sum(len(t) for t in texts) // 4
    projected_cost = budget.estimate_cost_usd(choice, rough_tokens, 0)
    await budget.assert_budget(session, workspace_id, projected_cost)

    client = _client_for(choice)
    # Qwen v2 supports batched input; chunk if there are many.
    BATCH = 25
    out: list[list[float]] = []
    for i in range(0, len(texts), BATCH):
        batch = texts[i : i + BATCH]
        resp = await _with_one_retry(
            lambda batch=batch: client.embeddings.create(model=choice.model, input=batch),
            op_name=f"{choice.provider}.embeddings",
        )
        for d in resp.data:
            vec = list(d.embedding)
            if len(vec) != EMBED_DIM:
                raise RuntimeError(
                    f"Embedding dim mismatch: model returned {len(vec)}, schema expects {EMBED_DIM}. "
                    "Update artifacts.embeddings vector(N) or pick a model with matching dim."
                )
            out.append(vec)
    return out


# ── Feedback-loop helper (design rule #2) ───────────────────────────


async def recent_feedback(
    session: AsyncSession,
    project_id: UUID,
    action_type: TaskType,
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Pull recent `manager_actions` rows for a project + action_type
    that already have a human verdict (accepted, rejected, or feedback text).
    Used by M5/M6/M7 to inject prior feedback into the next prompt.
    """
    rows = (
        await session.execute(
            text(
                """
                select id, output, accepted_by_human, human_feedback, created_at
                from public.manager_actions
                where project_id = :pid
                  and action_type = :atype
                  and (accepted_by_human is not null or human_feedback is not null)
                order by created_at desc
                limit :limit
                """
            ),
            {"pid": str(project_id), "atype": action_type, "limit": limit},
        )
    ).all()
    return [
        {
            "id": str(r[0]),
            "output": r[1],
            "accepted_by_human": r[2],
            "human_feedback": r[3],
            "created_at": r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


# ── Smoke-test ping ─────────────────────────────────────────────────


async def ping_provider() -> dict[str, Any]:
    """Round-trip Moonshot once with a trivial prompt. No DB writes."""
    choice = ROUTING["ping"]
    client = _client_for(choice)
    started = time.monotonic()
    resp = await _with_one_retry(
        lambda: client.chat.completions.create(
            model=choice.model,
            messages=[
                {"role": "system", "content": "Reply with exactly: pong"},
                {"role": "user", "content": "ping"},
            ],
            temperature=0,
            max_tokens=10,
        ),
        op_name=f"{choice.provider}.ping",
    )
    return {
        "provider": choice.provider,
        "model": choice.model,
        "content": (resp.choices[0].message.content or "").strip(),
        "latency_ms": int((time.monotonic() - started) * 1000),
    }


# Convenience for one-off scripts
def run(coro):  # pragma: no cover
    return asyncio.run(coro)
