-- 0004 storage_buckets
-- Artifacts bucket + path-based RLS so files inherit workspace
-- boundaries. Path convention: <workspace_id>/<artifact_id>/<filename>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'artifacts',
  'artifacts',
  false,
  20971520,
  null
)
on conflict (id) do nothing;

create policy "workspace members can read artifact files"
on storage.objects for select to authenticated
using (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1]::uuid = public.current_workspace_id()
);

create policy "workspace members can upload artifact files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1]::uuid = public.current_workspace_id()
);

create policy "workspace members can delete their own artifact files"
on storage.objects for delete to authenticated
using (
  bucket_id = 'artifacts'
  and (storage.foldername(name))[1]::uuid = public.current_workspace_id()
);
