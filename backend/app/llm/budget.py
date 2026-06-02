"""Per-workspace daily LLM spend cap.

Design rule #5 from docs/PLAN.md: a workspace must not exceed its daily
LLM budget. Enforced by `assert_budget()` which raises before the call.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.llm.routing import ModelChoice


class BudgetExceededError(RuntimeError):
    pass


def _today_utc_start() -> datetime:
    now = datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def estimate_cost_usd(
    choice: ModelChoice,
    input_tokens: int,
    output_tokens: int,
) -> float:
    return (
        (input_tokens / 1_000_000) * choice.input_usd_per_mtok
        + (output_tokens / 1_000_000) * choice.output_usd_per_mtok
    )


async def spent_today_usd(session: AsyncSession, workspace_id: UUID) -> float:
    """Sum estimated spend across today's manager_actions rows for the workspace."""
    row = (
        await session.execute(
            text(
                """
                select coalesce(sum(
                  (input_context->'usage'->>'estimated_cost_usd')::numeric
                ), 0) as spent
                from public.manager_actions ma
                join public.projects p on ma.project_id = p.id
                where p.workspace_id = :ws
                  and ma.created_at >= :start
                """
            ),
            {"ws": str(workspace_id), "start": _today_utc_start()},
        )
    ).scalar_one()
    return float(row or 0.0)


async def workspace_budget_usd(session: AsyncSession, workspace_id: UUID) -> float:
    row = (
        await session.execute(
            text("select llm_budget_daily_usd from public.workspaces where id = :ws"),
            {"ws": str(workspace_id)},
        )
    ).scalar_one_or_none()
    if row is None:
        raise BudgetExceededError(f"Workspace {workspace_id} not found.")
    return float(row)


async def assert_budget(
    session: AsyncSession,
    workspace_id: UUID,
    estimated_cost_usd: float,
) -> None:
    spent = await spent_today_usd(session, workspace_id)
    budget = await workspace_budget_usd(session, workspace_id)
    if spent + estimated_cost_usd > budget:
        raise BudgetExceededError(
            f"Workspace {workspace_id}: today's spend ${spent:.4f} + projected "
            f"${estimated_cost_usd:.4f} would exceed daily cap ${budget:.2f}."
        )
