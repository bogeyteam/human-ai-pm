-- 0012 meetings_template_slot_uniq
-- A3 (robustness): make recurring-meeting spawning idempotent at the DB level.
--
-- The spawner computes a deterministic scheduled_at per template per local day
-- (combine(today_local, time_of_day) at the template timezone). A duplicate
-- tick (double cron fire, or a second replica) would otherwise insert a second
-- identical meeting. A unique index on (template_id, scheduled_at) lets the
-- worker use `on conflict do nothing`, so duplicates collapse to a no-op.
--
-- Partial index: only template-spawned meetings participate; ad-hoc meetings
-- (template_id is null) are unconstrained.
create unique index if not exists meetings_template_slot_uniq
  on public.meetings (template_id, scheduled_at)
  where template_id is not null;
