-- 0005 findings_table
-- One new table beyond PRD §5 — needed because the data model
-- has no home for AI-generated cross-task suggestions. Findings
-- are user-facing artifacts (not just audit entries in
-- manager_actions), so they get their own table.

create table public.findings (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects(id) on delete cascade,
  source_artifact_id  uuid references public.artifacts(id) on delete cascade,
  source_task_id      uuid references public.tasks(id) on delete set null,
  target_task_id      uuid not null references public.tasks(id) on delete cascade,
  target_owner_id     uuid references public.users(id) on delete set null,
  how_to_use          text not null,
  status              text not null default 'new'
                      check (status in ('new','acknowledged','linked','dismissed')),
  dismiss_reason      text,
  feedback_note       text,
  manager_action_id   uuid references public.manager_actions(id) on delete set null,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

create index findings_project_status_idx
  on public.findings (project_id, status, created_at desc);
create index findings_target_owner_idx
  on public.findings (target_owner_id, status)
  where status in ('new','acknowledged');
create index findings_target_task_idx on public.findings (target_task_id);

create unique index findings_uniq_artifact_target_idx
  on public.findings (source_artifact_id, target_task_id)
  where source_artifact_id is not null;

alter table public.findings enable row level security;

create policy "members access workspace findings" on public.findings
  for all to authenticated
  using (project_id in (
    select id from public.projects where workspace_id = public.current_workspace_id()
  ))
  with check (project_id in (
    select id from public.projects where workspace_id = public.current_workspace_id()
  ));
