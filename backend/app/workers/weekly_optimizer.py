"""Weekly Backlog Optimizer scheduler (M7).

Exposes `make_scheduler()` for `app.main.lifespan` to start/stop.
The cron job is **disabled outside production** to avoid firing during dev
or test runs — flip `APP_ENV=production` in the deployed env to enable.

Loop cap (design rule #3): each cron tick runs `run_optimizer_for_project`
once per active project (one LLM round-trip each), no recursion.
"""

from __future__ import annotations

import logging
from uuid import UUID

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from app.api.optimizer import run_optimizer_for_project
from app.db import session_scope
from app.settings import get_settings
from app.workers.spawn_recurring_meetings import spawn_due_meetings

log = logging.getLogger(__name__)


async def _run_for_all_active_projects() -> None:
    """One scheduler tick: iterate active projects, run optimizer once each.

    A failure on one project must not block the others.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    select p.id, p.workspace_id
                    from public.projects p
                    """
                )
            )
        ).all()

    for project_id, workspace_id in rows:
        try:
            async with session_scope() as session:
                await run_optimizer_for_project(
                    session, UUID(str(project_id)), UUID(str(workspace_id))
                )
            log.info("weekly_optimizer ran for project=%s", project_id)
        except Exception:  # noqa: BLE001 — one bad project must not stop the rest.
            log.exception("weekly_optimizer failed for project=%s", project_id)


def make_scheduler() -> AsyncIOScheduler:
    """Build (but do not start) the scheduler.

    Production-only gate: in any non-production env we still build the scheduler
    so `lifespan` can manage it uniformly, but we do NOT register the cron job —
    that would otherwise fire during local dev or CI.
    """
    scheduler = AsyncIOScheduler(timezone="UTC")
    s = get_settings()
    if s.app_env == "production":
        scheduler.add_job(
            _run_for_all_active_projects,
            trigger=CronTrigger(day_of_week="mon", hour=9, minute=0, timezone="UTC"),
            id="weekly_backlog_optimizer",
            name="Weekly backlog optimizer",
            replace_existing=True,
            misfire_grace_time=3600,
        )
        scheduler.add_job(
            spawn_due_meetings,
            trigger=CronTrigger(hour=0, minute=5, timezone="UTC"),
            id="spawn_recurring_meetings",
            name="Spawn recurring meeting instances",
            replace_existing=True,
            misfire_grace_time=3600,
        )
    else:
        log.info(
            "weekly_optimizer cron is DISABLED in app_env=%s (production only).",
            s.app_env,
        )
        log.info(
            "spawn_recurring_meetings cron is DISABLED in app_env=%s (production only).",
            s.app_env,
        )
    return scheduler
