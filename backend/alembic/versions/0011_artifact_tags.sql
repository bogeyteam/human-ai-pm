-- M20 — artifact organization: tags + many-to-many + saved views.
-- Strictly additive: three new tables, no DROP, no ALTER on existing
-- tables. Existing artifacts/tasks/decisions/findings/meetings rows
-- cannot be modified by this migration.

create table public.tags (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  kind        text not null default 'topic'
    check (kind in ('topic','phase','persona','custom')),
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null,
  unique (project_id, name)
);
create index tags_project_id_idx on public.tags (project_id);
create index tags_project_kind_idx on public.tags (project_id, kind);

create table public.artifact_tags (
  artifact_id uuid not null references public.artifacts(id) on delete cascade,
  tag_id      uuid not null references public.tags(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (artifact_id, tag_id)
);
create index artifact_tags_tag_id_idx on public.artifact_tags (tag_id);

create table public.saved_views (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  filters     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.users(id) on delete set null,
  unique (project_id, name)
);
create index saved_views_project_id_idx on public.saved_views (project_id);

alter table public.tags enable row level security;
alter table public.artifact_tags enable row level security;
alter table public.saved_views enable row level security;

create policy "tags: signed-in read"   on public.tags for select using (auth.role() = 'authenticated');
create policy "tags: signed-in write"  on public.tags for insert with check (auth.role() = 'authenticated');
create policy "tags: signed-in update" on public.tags for update using (auth.role() = 'authenticated');
create policy "tags: signed-in delete" on public.tags for delete using (auth.role() = 'authenticated');

create policy "artifact_tags: signed-in read"   on public.artifact_tags for select using (auth.role() = 'authenticated');
create policy "artifact_tags: signed-in write"  on public.artifact_tags for insert with check (auth.role() = 'authenticated');
create policy "artifact_tags: signed-in delete" on public.artifact_tags for delete using (auth.role() = 'authenticated');

create policy "saved_views: signed-in read"   on public.saved_views for select using (auth.role() = 'authenticated');
create policy "saved_views: signed-in write"  on public.saved_views for insert with check (auth.role() = 'authenticated');
create policy "saved_views: signed-in update" on public.saved_views for update using (auth.role() = 'authenticated');
create policy "saved_views: signed-in delete" on public.saved_views for delete using (auth.role() = 'authenticated');
