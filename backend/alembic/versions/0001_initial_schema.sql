-- ============================================================
-- 0001 initial_schema
-- ============================================================
-- Source of truth for the initial database schema. Mirrors
-- PRD §5 verbatim, plus the minimal additions flagged in the
-- approved plan (`docs/PLAN.md`):
--   * workspaces.llm_budget_daily_usd  (cost cap, design rule #5)
--   * id/created_at defaults, FK ON DELETE behaviour, indexes,
--     pgvector HNSW index, and RLS policies enforcing
--     multi-tenant boundaries from day one.
--
-- coaching_sessions is created NOW even though coaching is a V1
-- feature, because the privacy boundary is real from day one
-- (PRD §4.2, design rule #4).
--
-- Order matters: tables before functions before policies.
-- LANGUAGE SQL functions check referenced relations at creation
-- time, so the helper must be defined after the tables it reads.
-- ============================================================

create extension if not exists "vector";

-- ── Tables ────────────────────────────────────────────────────

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  -- Per design rule #5 — daily LLM spend ceiling. Default $2/day
  -- = $60/month max, well above MVP target <$10/mo (PRD §9.5).
  llm_budget_daily_usd numeric not null default 2.00,
  created_at  timestamptz not null default now()
);

create table public.users (
  -- Mirrors auth.users 1:1 — trigger below auto-creates a row
  -- when someone signs up via Supabase Auth.
  id           uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  email        text unique not null,
  name         text,
  role         text not null default 'member' check (role in ('founder', 'member')),
  skills       jsonb not null default '[]'::jsonb,
  work_style   jsonb not null default '{}'::jsonb,
  timezone     text  not null default 'Asia/Shanghai'
);
create index users_workspace_id_idx on public.users (workspace_id);

create table public.projects (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  vision        text,
  current_stage text not null default 'discovery'
                check (current_stage in ('discovery', 'validation', 'launch', 'scale')),
  preferences   jsonb not null default '{"speed":0.33,"quality":0.34,"cost":0.33}'::jsonb,
  created_at    timestamptz not null default now()
);
create index projects_workspace_id_idx on public.projects (workspace_id);

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  title           text not null,
  description     text,
  owner_id        uuid references public.users(id) on delete set null,
  status          text not null default 'backlog'
                  check (status in ('backlog','ready','in_progress','blocked','done','dropped')),
  priority        int not null default 0,
  estimated_hours numeric,
  actual_hours    numeric,
  created_by      text not null default 'human' check (created_by in ('human','ai')),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  metadata        jsonb not null default '{}'::jsonb
);
create index tasks_project_status_idx on public.tasks (project_id, status);
create index tasks_owner_idx on public.tasks (owner_id);

create table public.task_dependencies (
  prereq_task_id    uuid not null references public.tasks(id) on delete cascade,
  dependent_task_id uuid not null references public.tasks(id) on delete cascade,
  primary key (prereq_task_id, dependent_task_id),
  check (prereq_task_id <> dependent_task_id)
);
create index task_dependencies_dependent_idx
  on public.task_dependencies (dependent_task_id);

create table public.artifacts (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid references public.tasks(id) on delete cascade,
  type        text not null check (type in ('doc','link','decision','image','dataset')),
  title       text not null,
  content     text,
  storage_url text,
  embeddings  vector(1536),
  created_at  timestamptz not null default now()
);
create index artifacts_task_id_idx on public.artifacts (task_id);
-- HNSW for cosine similarity (PRD §6.2 cross-task discovery).
create index artifacts_embeddings_hnsw_idx
  on public.artifacts using hnsw (embeddings vector_cosine_ops);

create table public.messages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  task_id     uuid references public.tasks(id) on delete set null,
  sender_type text not null check (sender_type in ('user','ai_manager','integration')),
  sender_id   text,
  content     text not null,
  channel     text not null default 'in_app',
  created_at  timestamptz not null default now()
);
create index messages_project_created_idx on public.messages (project_id, created_at desc);
create index messages_task_idx on public.messages (task_id);

create table public.decisions (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.projects(id) on delete cascade,
  question                text not null,
  decision                text not null,
  reasoning               text,
  alternatives_considered text,
  decided_by              uuid references public.users(id) on delete set null,
  decided_at              timestamptz not null default now(),
  review_at               timestamptz
);
create index decisions_project_decided_idx on public.decisions (project_id, decided_at desc);

-- ─── coaching_sessions: PHYSICALLY ISOLATED (design rule #4) ──
-- Strict per-user RLS below. Workspace members (including
-- founders) cannot read other members' coaching transcripts.
create table public.coaching_sessions (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references public.users(id) on delete cascade,
  project_context_snapshot  jsonb not null default '{}'::jsonb,
  transcript                text,
  insights                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);
create index coaching_sessions_user_idx on public.coaching_sessions (user_id);

create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  type             text not null check (type in ('biweekly_planning','weekly_retro','daily_ops','ad_hoc')),
  scheduled_at     timestamptz,
  agenda           jsonb not null default '{}'::jsonb,
  attendees        uuid[] not null default '{}'::uuid[],
  notes            text,
  ai_pre_brief     text,
  ai_post_summary  text
);
create index meetings_project_idx on public.meetings (project_id, scheduled_at desc);

-- ─── manager_actions: audit + RL signal source ────────────────
-- Lookups in M5/M6/M7 prompt assembly pull last-N rows scoped by
-- (project_id, action_type) ordered by created_at desc.
create table public.manager_actions (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  action_type       text not null,
  input_context     jsonb not null default '{}'::jsonb,
  output            jsonb not null default '{}'::jsonb,
  accepted_by_human boolean,
  human_feedback    text,
  created_at        timestamptz not null default now()
);
create index manager_actions_project_type_created_idx
  on public.manager_actions (project_id, action_type, created_at desc);

-- ── Functions & triggers ──────────────────────────────────────

-- RLS helper. SECURITY DEFINER so RLS on users itself doesn't
-- block the lookup. STABLE so it's cached per-statement.
create or replace function public.current_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select workspace_id from public.users where id = auth.uid()
$$;
revoke all on function public.current_workspace_id() from public;
grant execute on function public.current_workspace_id() to authenticated;

-- Auto-create a public.users row when someone signs up via auth.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- ── Row Level Security ────────────────────────────────────────

alter table public.workspaces        enable row level security;
alter table public.users             enable row level security;
alter table public.projects          enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.artifacts         enable row level security;
alter table public.messages          enable row level security;
alter table public.decisions         enable row level security;
alter table public.coaching_sessions enable row level security;
alter table public.meetings          enable row level security;
alter table public.manager_actions   enable row level security;

create policy "members read own workspace" on public.workspaces
  for select to authenticated using (id = public.current_workspace_id());

create policy "any authenticated user can insert a workspace" on public.workspaces
  for insert to authenticated with check (true);

create policy "founders update own workspace" on public.workspaces
  for update to authenticated
  using (id = public.current_workspace_id())
  with check (id = public.current_workspace_id());

create policy "read self" on public.users
  for select to authenticated using (id = auth.uid());

create policy "read teammates" on public.users
  for select to authenticated using (workspace_id = public.current_workspace_id());

create policy "insert self" on public.users
  for insert to authenticated with check (id = auth.uid());

create policy "update self" on public.users
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "members read workspace projects" on public.projects
  for select to authenticated using (workspace_id = public.current_workspace_id());

create policy "members write workspace projects" on public.projects
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

create policy "members access workspace tasks" on public.tasks
  for all to authenticated
  using (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()))
  with check (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()));

create policy "members access workspace deps" on public.task_dependencies
  for all to authenticated
  using (prereq_task_id in (
    select t.id from public.tasks t
    join public.projects p on t.project_id = p.id
    where p.workspace_id = public.current_workspace_id()))
  with check (prereq_task_id in (
    select t.id from public.tasks t
    join public.projects p on t.project_id = p.id
    where p.workspace_id = public.current_workspace_id()));

create policy "members access workspace artifacts" on public.artifacts
  for all to authenticated
  using (
    task_id is null
    or task_id in (
      select t.id from public.tasks t
      join public.projects p on t.project_id = p.id
      where p.workspace_id = public.current_workspace_id()))
  with check (
    task_id is null
    or task_id in (
      select t.id from public.tasks t
      join public.projects p on t.project_id = p.id
      where p.workspace_id = public.current_workspace_id()));

create policy "members access workspace messages" on public.messages
  for all to authenticated
  using (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()))
  with check (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()));

create policy "members access workspace decisions" on public.decisions
  for all to authenticated
  using (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()))
  with check (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()));

-- coaching_sessions: strict per-user. Even founders cannot peek.
create policy "session owner only" on public.coaching_sessions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members access workspace meetings" on public.meetings
  for all to authenticated
  using (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()))
  with check (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()));

-- manager_actions: workspace-readable; updates (feedback) by
-- members; inserts only via service role (no INSERT policy).
create policy "members read workspace manager actions" on public.manager_actions
  for select to authenticated
  using (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()));

create policy "members update feedback on own workspace actions" on public.manager_actions
  for update to authenticated
  using (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()))
  with check (project_id in (select id from public.projects where workspace_id = public.current_workspace_id()));
