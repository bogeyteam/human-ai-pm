-- 0003 workspace_bootstrap_rpc
-- Atomic create-workspace-and-join-as-founder. Frontend calls
-- this RPC; eliminates an entire backend endpoint for M3.

create or replace function public.bootstrap_workspace(
  workspace_name text,
  display_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_ws_id uuid;
  existing_ws uuid;
begin
  select workspace_id into existing_ws from public.users where id = auth.uid();
  if existing_ws is not null then
    raise exception 'User % is already in workspace %', auth.uid(), existing_ws
      using errcode = '23505';
  end if;

  insert into public.workspaces (name) values (workspace_name)
    returning id into new_ws_id;

  update public.users
    set workspace_id = new_ws_id,
        role = 'founder',
        name = coalesce(display_name, name)
    where id = auth.uid();

  return new_ws_id;
end;
$$;

revoke execute on function public.bootstrap_workspace(text, text) from public;
revoke execute on function public.bootstrap_workspace(text, text) from anon;
grant execute on function public.bootstrap_workspace(text, text) to authenticated;
