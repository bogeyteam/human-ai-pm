"""Recurring meeting spawner (M16).

Reads `meeting_templates` and inserts new `meetings` rows when the cadence is
due. Idempotent via `meeting_templates.last_spawned_at` — a second run on the
same local day (daily) or same week/biweek window (weekly/biweekly) is a no-op.

Design rules:
- One session/try per template so a single bad row can't block the rest.
- All timezone math happens Postgres-side (template.timezone is IANA).
- SQLAlchemy text() only. Use `cast(:p as type)` — never `:p::type`.
"""

from __future__ import annotations

import logging
from datetime import date, datetime

from sqlalchemy import text

from app.db import session_scope

log = logging.getLogger(__name__)


async def spawn_due_meetings() -> None:
    """One scheduler tick: spawn any meetings whose cadence has come due."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    select id,
                           project_id,
                           type,
                           cadence,
                           day_of_week,
                           time_of_day,
                           timezone,
                           default_attendees,
                           last_spawned_at,
                           (current_date at time zone timezone) as today_local,
                           extract(dow from (now() at time zone timezone))::int as dow_local
                    from public.meeting_templates
                    where active = true
                    """
                )
            )
        ).mappings().all()

    for tpl in rows:
        try:
            await _spawn_one(dict(tpl))
        except Exception:  # noqa: BLE001 — one bad template must not stop the rest.
            log.exception(
                "spawn_recurring_meetings failed for template=%s", tpl.get("id")
            )


async def _spawn_one(tpl: dict) -> None:
    """Evaluate a single template and, if due, insert a meeting + bump last_spawned_at."""
    cadence = tpl["cadence"]
    last = tpl["last_spawned_at"]
    dow_local = tpl["dow_local"]
    day_of_week = tpl["day_of_week"]

    async with session_scope() as session:
        # `current_date at time zone tz` returns timestamp-without-tz in PG, which
        # asyncpg surfaces as a `datetime`. Normalize to a `date` for daily compare.
        raw_today = tpl["today_local"]
        today_local: date = raw_today.date() if isinstance(raw_today, datetime) else raw_today
        # `time_of_day` came back as a python `time`.
        time_of_day = tpl["time_of_day"]

        due = False
        if cadence == "daily":
            due = last is None or last.date() < today_local
        elif cadence == "weekly":
            if dow_local == day_of_week:
                check = await session.execute(
                    text(
                        """
                        select :last is null
                            or cast(:last as timestamptz) < now() - interval '5 days'
                        """
                    ),
                    {"last": last},
                )
                due = bool(check.scalar())
        elif cadence == "biweekly":
            if dow_local == day_of_week:
                check = await session.execute(
                    text(
                        """
                        select :last is null
                            or cast(:last as timestamptz) < now() - interval '12 days'
                        """
                    ),
                    {"last": last},
                )
                due = bool(check.scalar())
        else:
            log.warning(
                "spawn_recurring_meetings: unknown cadence=%s template=%s",
                cadence,
                tpl["id"],
            )
            return

        if not due:
            return

        # Build a naive datetime in the template's local timezone, then let
        # Postgres convert to UTC via `<naive> at time zone tz` (returns timestamptz).
        scheduled_local = datetime.combine(today_local, time_of_day)

        # default_attendees comes back as a list[UUID] (or list[str]); copy to avoid aliasing.
        attendees = list(tpl["default_attendees"] or [])

        inserted = await session.execute(
            text(
                """
                insert into public.meetings
                    (project_id, type, scheduled_at, attendees, template_id)
                values (
                    cast(:pid as uuid),
                    :type,
                    cast(:scheduled_local as timestamp) at time zone :tz,
                    cast(:attendees as uuid[]),
                    cast(:tid as uuid)
                )
                on conflict (template_id, scheduled_at)
                    where template_id is not null do nothing
                returning id
                """
            ),
            {
                "pid": str(tpl["project_id"]),
                "type": tpl["type"],
                "scheduled_local": scheduled_local,
                "tz": tpl["timezone"],
                "attendees": [str(a) for a in attendees],
                "tid": str(tpl["id"]),
            },
        )
        meeting_id = inserted.scalar()

        # `on conflict do nothing` returns no row when this exact slot was
        # already spawned (a duplicate cron tick or a second replica racing the
        # idempotency check). Don't bump last_spawned_at — there's nothing new,
        # and the meeting that already exists stands. (Requires the partial
        # unique index from migration 0012.)
        if meeting_id is None:
            log.info(
                "spawn_recurring_meetings: slot already spawned for template=%s "
                "(no-op, idempotent)",
                tpl["id"],
            )
            return

        await session.execute(
            text(
                """
                update public.meeting_templates
                   set last_spawned_at = now()
                 where id = :tid
                """
            ),
            {"tid": str(tpl["id"])},
        )

        log.info(
            "spawn_recurring_meetings: spawned meeting=%s from template=%s (%s)",
            meeting_id,
            tpl["id"],
            cadence,
        )
