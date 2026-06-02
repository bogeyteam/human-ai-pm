import { supabaseServer } from "@/lib/supabase-server";

import { QuestionsPanel, type QuestionRow } from "./questions-panel";

export default async function QuestionsPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Name the FKs explicitly — open_questions has two relationships into tasks
  // (source_task_id) and one into users (target_owner_id); PostgREST needs the
  // disambiguated constraint name or it returns a SelectQueryError.
  const [{ data: questions }, { data: tasks }, { data: teammates }] = await Promise.all([
    supabase
      .from("open_questions")
      .select(
        `id, question, question_zh, question_en, drafted_message_zh, drafted_message_en,
         status, dismiss_reason, feedback_note, blast_radius, created_at, resolved_at,
         source_task_id, source_decision_id, target_owner_id,
         source_task:tasks!open_questions_source_task_id_fkey (id, title),
         routed_owner:users!open_questions_target_owner_id_fkey (id, name, email)`,
      )
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, title").eq("project_id", params.id),
    supabase.from("users").select("id, name, email"),
  ]);

  return (
    <QuestionsPanel
      projectId={params.id}
      currentUserId={user?.id ?? null}
      initialQuestions={(questions ?? []) as unknown as QuestionRow[]}
      taskTitles={Object.fromEntries((tasks ?? []).map((t) => [t.id, t.title]))}
      teammates={teammates ?? []}
    />
  );
}
