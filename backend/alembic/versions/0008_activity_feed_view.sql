-- 0008 activity_feed_view
-- UNION view over recent events from existing timestamped tables.
-- No new tables, no triggers, no audit infra. Workspace visibility is
-- inherited from each source table's RLS — views select-as-invoker
-- by default in Postgres.

create or replace view public.activity_feed as
  select
    'task_created'::text as event_type,
    t.created_at as event_at,
    t.project_id,
    t.id as entity_id,
    t.owner_id as actor_id,
    t.title as label,
    coalesce(t.description, '') as detail
  from public.tasks t
  union all
  select
    'artifact_added',
    a.created_at,
    a.project_id,
    a.id,
    null::uuid,
    a.title,
    coalesce(a.type, '')
  from public.artifacts a
  union all
  select
    'decision_logged',
    d.decided_at,
    d.project_id,
    d.id,
    d.decided_by,
    d.decision,
    coalesce(d.reasoning, '')
  from public.decisions d
  union all
  select
    case when ma.accepted_by_human then 'ai_accepted' else 'ai_rejected' end,
    ma.created_at,
    ma.project_id,
    ma.id,
    null::uuid,
    ma.action_type,
    ''
  from public.manager_actions ma
  where ma.accepted_by_human is not null
  union all
  select
    'finding_surfaced',
    f.created_at,
    f.project_id,
    f.id,
    f.target_owner_id,
    coalesce(left(f.how_to_use, 80), ''),
    ''
  from public.findings f
  union all
  select
    'meeting_scheduled',
    coalesce(m.scheduled_at, now()),
    m.project_id,
    m.id,
    null::uuid,
    m.type,
    coalesce(m.ai_post_summary, '')
  from public.meetings m;

grant select on public.activity_feed to authenticated;
