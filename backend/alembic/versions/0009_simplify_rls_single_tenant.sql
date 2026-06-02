-- 0009 simplify_rls_single_tenant
-- The fanpo team is small + trusted. Drop workspace-based isolation
-- across all tables EXCEPT coaching_sessions (per-user private — the
-- PRD §4.2 privacy boundary stays sacred).
--
-- Any authenticated user can read/write any non-coaching row. Sign-up
-- IS the security gate; lock down further by disabling public sign-up
-- in Supabase Auth → Settings, or by adding an email-domain allowlist.

-- workspaces
drop policy if exists "members read own workspace" on public.workspaces;
drop policy if exists "users without a workspace can create one" on public.workspaces;
drop policy if exists "founders update own workspace" on public.workspaces;
drop policy if exists "any authenticated user can insert a workspace" on public.workspaces;
create policy "any auth read workspaces" on public.workspaces for select to authenticated using (true);
create policy "any auth insert workspaces" on public.workspaces for insert to authenticated with check (true);
create policy "any auth update workspaces" on public.workspaces for update to authenticated using (true) with check (true);

-- users: read all, self-only writes
drop policy if exists "read self" on public.users;
drop policy if exists "read teammates" on public.users;
drop policy if exists "insert self" on public.users;
drop policy if exists "update self" on public.users;
create policy "any auth read users" on public.users for select to authenticated using (true);
create policy "self insert" on public.users for insert to authenticated with check (id = auth.uid());
create policy "self update" on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- projects
drop policy if exists "members read workspace projects" on public.projects;
drop policy if exists "members write workspace projects" on public.projects;
create policy "any auth access projects" on public.projects for all to authenticated using (true) with check (true);

-- tasks / deps / artifacts / messages / decisions / meetings / findings
drop policy if exists "members access workspace tasks" on public.tasks;
create policy "any auth access tasks" on public.tasks for all to authenticated using (true) with check (true);

drop policy if exists "members access workspace deps" on public.task_dependencies;
create policy "any auth access deps" on public.task_dependencies for all to authenticated using (true) with check (true);

drop policy if exists "members access workspace artifacts" on public.artifacts;
create policy "any auth access artifacts" on public.artifacts for all to authenticated using (true) with check (true);

drop policy if exists "members access workspace messages" on public.messages;
create policy "any auth access messages" on public.messages for all to authenticated using (true) with check (true);

drop policy if exists "members access workspace decisions" on public.decisions;
create policy "any auth access decisions" on public.decisions for all to authenticated using (true) with check (true);

drop policy if exists "members access workspace meetings" on public.meetings;
create policy "any auth access meetings" on public.meetings for all to authenticated using (true) with check (true);

drop policy if exists "members access workspace findings" on public.findings;
create policy "any auth access findings" on public.findings for all to authenticated using (true) with check (true);

-- manager_actions: read by any auth, update for feedback by any auth.
-- Insert remains service-role only (no policy for authenticated).
drop policy if exists "members read workspace manager actions" on public.manager_actions;
drop policy if exists "members update feedback on own workspace actions" on public.manager_actions;
create policy "any auth read manager actions" on public.manager_actions for select to authenticated using (true);
create policy "any auth update manager actions" on public.manager_actions for update to authenticated using (true) with check (true);

-- workspace_invites: kept for downgrade; no longer required
drop policy if exists "members manage own workspace invites" on public.workspace_invites;
drop policy if exists "anyone can read invite by token" on public.workspace_invites;
create policy "any auth access invites" on public.workspace_invites for all to authenticated using (true) with check (true);

-- Storage: artifacts bucket
drop policy if exists "workspace members can read artifact files" on storage.objects;
drop policy if exists "workspace members can upload artifact files" on storage.objects;
drop policy if exists "workspace members can delete their own artifact files" on storage.objects;
create policy "any auth read artifact files" on storage.objects for select to authenticated using (bucket_id = 'artifacts');
create policy "any auth upload artifact files" on storage.objects for insert to authenticated with check (bucket_id = 'artifacts');
create policy "any auth delete artifact files" on storage.objects for delete to authenticated using (bucket_id = 'artifacts');

-- coaching_sessions UNCHANGED: per-user private (PRD §4.2 / design rule #4).

-- Auto-assign every new signup to the oldest workspace so they land on
-- a populated /projects page instead of an empty /onboard flow.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_ws uuid;
begin
  select id into default_ws from public.workspaces order by created_at asc limit 1;
  insert into public.users (id, email, workspace_id)
  values (new.id, new.email, default_ws)
  on conflict (id) do nothing;
  return new;
end;
$$;
