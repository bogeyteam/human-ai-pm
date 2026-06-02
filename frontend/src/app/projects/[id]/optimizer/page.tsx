import { supabaseServer } from "@/lib/supabase-server";

import { OptimizerPanel, type LatestReview } from "./optimizer-panel";

export default async function OptimizerPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();

  const [{ data: actionRow }, { data: tasks }] = await Promise.all([
    supabase
      .from("manager_actions")
      .select("id, output, accepted_by_human, human_feedback, created_at")
      .eq("project_id", params.id)
      .eq("action_type", "backlog_optimizer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id, title, status, priority")
      .eq("project_id", params.id)
      .in("status", ["backlog", "ready", "in_progress", "blocked"]),
  ]);

  let latest: LatestReview | null = null;
  if (actionRow) {
    const rawContent =
      (actionRow.output as { content?: string } | null)?.content ?? null;
    let parsed: Record<string, unknown> | null = null;
    if (rawContent) {
      try {
        parsed = JSON.parse(rawContent) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
    }
    latest = {
      manager_action_id: actionRow.id,
      created_at: actionRow.created_at,
      accepted_by_human: actionRow.accepted_by_human,
      human_feedback: actionRow.human_feedback,
      review: parsed,
    };
  }

  const taskTitles: Record<string, string> = {};
  for (const t of tasks ?? []) {
    taskTitles[t.id] = t.title;
  }

  return (
    <OptimizerPanel
      projectId={params.id}
      initialReview={latest}
      taskTitles={taskTitles}
    />
  );
}
