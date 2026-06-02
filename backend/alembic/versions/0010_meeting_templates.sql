-- M16 — recurring meeting templates.
-- A template is a blueprint; the worker spawns concrete `meetings` rows
-- on the configured cadence. Each spawned meeting has its own
-- notes/agenda/action items and lives independently from the template.

create table public.meeting_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type text not null,
  name text not null,
  cadence text not null,
  day_of_week int,
  time_of_day time not null default '09:00:00',
  timezone text not null default 'UTC',
  default_attendees uuid[] not null default '{}',
  active bool not null default true,
  last_spawned_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  check (cadence in ('daily','weekly','biweekly')),
  check (type in ('biweekly_planning','weekly_retro','daily_ops','ad_hoc')),
  check (cadence = 'daily' or day_of_week is not null),
  check (day_of_week is null or (day_of_week between 0 and 6))
);

alter table public.meetings
  add column template_id uuid references public.meeting_templates(id) on delete set null;

create index meeting_templates_project_id_idx on public.meeting_templates (project_id) where active = true;
create index meetings_template_id_idx on public.meetings (template_id) where template_id is not null;

-- RLS: single-tenant trust model from M13 — any signed-in user can read/write.
alter table public.meeting_templates enable row level security;
create policy "templates: signed-in read"   on public.meeting_templates for select using (auth.role() = 'authenticated');
create policy "templates: signed-in insert" on public.meeting_templates for insert with check (auth.role() = 'authenticated');
create policy "templates: signed-in update" on public.meeting_templates for update using (auth.role() = 'authenticated');
create policy "templates: signed-in delete" on public.meeting_templates for delete using (auth.role() = 'authenticated');
