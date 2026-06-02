import { supabaseServer } from "@/lib/supabase-server";

import { TasksKanban } from "./tasks-kanban";

export default async function TasksPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const [{ data: tasks }, { data: teammates }] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, title, description, status, priority, estimated_hours, actual_hours, owner_id, created_by, created_at",
      )
      .eq("project_id", params.id)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("users").select("id, name, email").order("name", { ascending: true, nullsFirst: false }),
  ]);

  return (
    <TasksKanban
      projectId={params.id}
      initialTasks={tasks ?? []}
      teammates={teammates ?? []}
    />
  );
}
