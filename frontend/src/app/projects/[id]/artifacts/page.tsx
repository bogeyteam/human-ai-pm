import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase-server";

import { ArtifactsPanel } from "./artifacts-panel";

type RawTag = { id: string; name: string; kind: string };
type RawArtifactRow = {
  id: string;
  task_id: string | null;
  project_id: string;
  type: string;
  title: string;
  content: string | null;
  storage_url: string | null;
  created_at: string;
  tasks: { id: string; title: string } | null;
  artifact_tags: { tag: RawTag | null }[] | null;
};

export default async function ArtifactsPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: artifacts }, { data: tasks }, { data: allTags }, { data: profile }] =
    await Promise.all([
      supabase
        .from("artifacts")
        .select(
          "id, task_id, project_id, type, title, content, storage_url, created_at, tasks(id, title), artifact_tags(tag:tags(id, name, kind))",
        )
        .eq("project_id", params.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, title")
        .eq("project_id", params.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tags")
        .select("id, name, kind")
        .eq("project_id", params.id)
        .order("name"),
      // .maybeSingle() because the `users` row or workspace_id may be absent;
      // ArtifactsPanel already handles an empty workspaceId by passing "".
      supabase.from("users").select("workspace_id").eq("id", user.id).maybeSingle(),
    ]);

  const flat = ((artifacts ?? []) as unknown as RawArtifactRow[]).map((a) => ({
    id: a.id,
    task_id: a.task_id,
    project_id: a.project_id,
    type: a.type,
    title: a.title,
    content: a.content,
    storage_url: a.storage_url,
    created_at: a.created_at,
    tasks: a.tasks,
    tags: ((a.artifact_tags ?? []) as { tag: RawTag | null }[])
      .map((r) => r.tag)
      .filter((t): t is RawTag => t !== null),
  }));

  return (
    <ArtifactsPanel
      projectId={params.id}
      workspaceId={profile?.workspace_id ?? ""}
      initialArtifacts={flat}
      initialAllTags={(allTags ?? []) as RawTag[]}
      tasks={tasks ?? []}
    />
  );
}
