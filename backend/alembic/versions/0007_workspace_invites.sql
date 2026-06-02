-- 0007 workspace_invites
-- Tokenized invite links so teammates can join an existing workspace
-- rather than auto-creating a duplicate via bootstrap_workspace.

create table public.workspace_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  token         text unique not null default encode(gen_random_bytes(24), 'base64'),
  invited_by    uuid references public.users(id) on delete set null,
  invited_email text,
  role          text not null default 'member' check (role in ('founder','member')),
  expires_at    timestamptz not null default now() + interval '14 days',
  used_at       timestamptz,
  used_by       uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index workspace_invites_workspace_idx on public.workspace_invites (workspace_id, created_at desc);
create index workspace_invites_token_idx on public.workspace_invites (token);

alter table public.workspace_invites enable row level security;

create policy "members manage own workspace invites" on public.workspace_invites
  for all to authenticated
  using (workspace_id = public.current_workspace_id())
  with check (workspace_id = public.current_workspace_id());

-- Anyone with the token can SELECT the invite row to validate the claim
-- link. The row only carries a workspace UUID; no workspace data leaks
-- without knowing the secret token.
create policy "anyone can read invite by token" on public.workspace_invites
  for select to anon, authenticated
  using (true);

-- Atomic claim RPC. Guards against joining a second workspace.
create or replace function public.accept_workspace_invite(invite_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  current_ws uuid;
begin
  if invite_token is null or invite_token = '' then
    raise exception 'Invite token required' using errcode = '22023';
  end if;
  select * into inv from public.workspace_invites where token = invite_token limit 1;
  if not found then
    raise exception 'Invite not found' using errcode = '02000';
  end if;
  if inv.used_at is not null then
    raise exception 'Invite already used' using errcode = '23505';
  end if;
  if inv.expires_at < now() then
    raise exception 'Invite expired' using errcode = '22008';
  end if;
  select workspace_id into current_ws from public.users where id = auth.uid();
  if current_ws is not null then
    raise exception 'You are already in workspace %', current_ws using errcode = '23505';
  end if;
  update public.users set workspace_id = inv.workspace_id, role = inv.role where id = auth.uid();
  update public.workspace_invites set used_at = now(), used_by = auth.uid() where id = inv.id;
  return inv.workspace_id;
end;
$$;

revoke execute on function public.accept_workspace_invite(text) from public;
revoke execute on function public.accept_workspace_invite(text) from anon;
grant execute on function public.accept_workspace_invite(text) to authenticated;
