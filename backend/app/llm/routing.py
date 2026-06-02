"""LLM task-type → (provider, model) routing.

Per PRD §9.3, the routing is hard-coded at this stage; the abstraction
exists so that swapping a model is a config change, not a code change.

Plan deviation (docs/PLAN.md): no LiteLLM. We call provider SDKs
(OpenAI-compatible for Moonshot/Qwen; anthropic SDK for Claude) directly.
"""

from dataclasses import dataclass
from typing import Literal

Provider = Literal["moonshot", "qwen", "anthropic"]
TaskType = Literal[
    "task_generation",
    "info_discovery",
    "backlog_optimizer",
    "meeting_pre_brief",
    "meeting_post_summary",
    "coaching",  # V1 — legacy Anthropic slot, retained for back-compat
    "coaching_session",  # M17 — single-shot guided reflection (Moonshot)
    "tag_suggestion",  # M20 — propose tags for a single artifact (Moonshot)
    "daily_brief",  # M21 — cross-feature "what needs attention today" digest
    "open_question",  # M21 — frame + draft + rank the project's blocking unknowns (Moonshot)
    "embeddings",
    "ping",  # smoke-test only
]


@dataclass(frozen=True, slots=True)
class ModelChoice:
    provider: Provider
    model: str
    # Rough input/output USD per 1M tokens — used for budget tracking.
    # Numbers are conservative ceilings; update from provider pricing pages.
    input_usd_per_mtok: float
    output_usd_per_mtok: float


# PRD §9.3 routing. Prices in USD/1M tokens (approximate, May 2026).
ROUTING: dict[TaskType, ModelChoice] = {
    "task_generation": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    "info_discovery": ModelChoice(
        provider="qwen",
        model="qwen-plus",
        input_usd_per_mtok=0.40,
        output_usd_per_mtok=1.20,
    ),
    "backlog_optimizer": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    "meeting_pre_brief": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    "meeting_post_summary": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    "coaching": ModelChoice(
        provider="anthropic",
        model="claude-opus-4-7",
        input_usd_per_mtok=15.00,
        output_usd_per_mtok=75.00,
    ),
    # M17 — V1 coaching ships on Moonshot (same SDK shape as the rest of the
    # gateway). Output is private to the user; budget still enforced against
    # the workspace cap. See app/api/coaching.py for the audit-target gate
    # that skips the manager_actions INSERT for this task type.
    "coaching_session": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    # M20 — tag suggestion is per-artifact, so input stays small. The 32k
    # context window is plenty (one artifact + project tag list + feedback)
    # and the per-mtok rate is identical to the larger variants at Moonshot
    # at this list, so we just pick the smaller-context model for clarity.
    "tag_suggestion": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-32k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    # M21 — Daily Brief synthesizes the whole project state in one pass, so it
    # benefits from the large context window. Same Moonshot rate as generation.
    "daily_brief": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    # M21 — Open Question Engine frames the project's blocking unknowns + drafts
    # bilingual outreach in one pass over full project state + all candidates +
    # feedback, so it wants the large context window. Same Moonshot rate as generation.
    "open_question": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-128k",
        input_usd_per_mtok=2.00,
        output_usd_per_mtok=4.00,
    ),
    "embeddings": ModelChoice(
        provider="qwen",
        model="text-embedding-v2",
        input_usd_per_mtok=0.07,
        output_usd_per_mtok=0.00,
    ),
    "ping": ModelChoice(
        provider="moonshot",
        model="moonshot-v1-8k",
        input_usd_per_mtok=1.00,
        output_usd_per_mtok=2.00,
    ),
}

EMBED_DIM = 1536  # must match artifacts.embeddings vector(N) in 0001_initial_schema.sql
