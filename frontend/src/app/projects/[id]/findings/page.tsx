import { supabaseServer } from "@/lib/supabase-server";

import { FindingsPanel } from "./findings-panel";

export default async function FindingsPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Disambiguate the two `tasks` relationships (source_task_id, target_task_id)
  // by naming the FK explicitly — otherwise PostgREST returns SelectQueryError.
  const [{ data: findings }] = await Promise.all([
    supabase
      .from("findings")
      .select(
        `id, how_to_use, status, dismiss_reason, feedback_note, created_at, resolved_at,
         target_owner_id, source_artifact_id, source_task_id, target_task_id,
         target_task:tasks!findings_target_task_id_fkey (id, title),
         source_artifact:source_artifact_id (id, title)`,
      )
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <FindingsPanel
      projectId={params.id}
      currentUserId={user?.id ?? null}
      initialFindings={findings ?? []}
    />
  );
}
