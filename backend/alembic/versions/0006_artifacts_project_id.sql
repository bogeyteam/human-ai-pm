-- 0006 artifacts_project_id
-- Deviation from PRD §5: add project_id to artifacts so unlinked artifacts
-- (task_id IS NULL) still have a project home. Without this, "Unlinked"
-- artifacts had no project association — invisible on every project tab.
-- task_id stays nullable — meaning "which task produced this", optional.

alter table public.artifacts
  add column project_id uuid references public.projects(id) on delete cascade;

update public.artifacts a
  set project_id = t.project_id
  from public.tasks t
  where a.task_id = t.id
    and a.project_id is null;

update public.artifacts a
  set project_id = (select p.id from public.projects p limit 1)
  where a.project_id is null
    and (select count(*) from public.projects) = 1;

alter table public.artifacts alter column project_id set not null;

create index artifacts_project_id_idx on public.artifacts (project_id);

drop policy if exists "members access workspace artifacts" on public.artifacts;

create policy "members access workspace artifacts" on public.artifacts
  for all to authenticated
  using (project_id in (
    select id from public.projects where workspace_id = public.current_workspace_id()
  ))
  with check (project_id in (
    select id from public.projects where workspace_id = public.current_workspace_id()
  ));
