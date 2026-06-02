-- ============================================================
-- 0002 harden_security
-- ============================================================
-- Addresses security advisor warnings from 0001_initial_schema:
--   * Move vector extension out of public schema
--   * Tighten workspaces INSERT policy (one workspace per user)
--   * Revoke handle_new_auth_user RPC exposure
--
-- One advisor warning is intentionally NOT addressed:
-- `current_workspace_id` remains executable by authenticated
-- because RLS policies invoke it in the caller's context. The
-- function only returns the user's own workspace_id, so there
-- is no privilege-escalation risk. Anon is revoked.
-- ============================================================

alter extension vector set schema extensions;

drop policy if exists "any authenticated user can insert a workspace" on public.workspaces;

create policy "users without a workspace can create one" on public.workspaces
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users
      where id = auth.uid() and workspace_id is null
    )
  );

revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.handle_new_auth_user() from anon;
revoke execute on function public.handle_new_auth_user() from authenticated;

revoke execute on function public.current_workspace_id() from anon;
