import { notFound, redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase-server";

import { ProjectNameEditor } from "./project-name-editor";
import { ProjectNav } from "./project-tabs";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Pull project + its workspace name in one round-trip via the
  // implicit foreign-key relationship. RLS guarantees we only see
  // workspaces we belong to, so a missing workspace falls back to a
  // sensible default rather than blowing up. Vision lives on Overview
  // (editable there); the layout header keeps just name + stage so
  // every project page doesn't repeat the same long brief.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, current_stage, workspace:workspaces(name)")
    .eq("id", params.id)
    .single<{
      id: string;
      name: string;
      current_stage: string;
      workspace: { name: string } | { name: string }[] | null;
    }>();
  if (!project) notFound();

  const workspaceName = Array.isArray(project.workspace)
    ? project.workspace[0]?.name ?? "Workspace"
    : project.workspace?.name ?? "Workspace";

  // B2 — live count badges for the nav. Cheap head-count queries (RLS-scoped).
  const [{ count: openTasks }, { count: openFindings }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("project_id", params.id)
      .in("status", ["backlog", "ready", "in_progress", "blocked"]),
    supabase
      .from("findings")
      .select("*", { count: "exact", head: true })
      .eq("project_id", params.id)
      .in("status", ["new", "acknowledged"]),
  ]);

  return (
    <div className="flex min-h-screen w-full">
      <ProjectNav
        projectId={project.id}
        projectName={project.name}
        workspaceName={workspaceName}
        counts={{ tasks: openTasks ?? 0, findings: openFindings ?? 0 }}
      />
      <main className="flex-1 min-w-0 bg-paper">
        <div className="mx-auto max-w-6xl px-6 py-8">
          <header className="mb-6">
            <p className="text-xs uppercase tracking-wider text-ink-3">
              {project.current_stage}
            </p>
            <ProjectNameEditor projectId={project.id} initialName={project.name} />
          </header>

          <section>{children}</section>
        </div>
      </main>
    </div>
  );
}
