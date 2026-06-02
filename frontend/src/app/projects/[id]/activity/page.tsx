import { supabaseServer } from "@/lib/supabase-server";

import { ActivityList } from "./activity-list";

export default async function ActivityPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const [{ data: events }, { data: teammates }] = await Promise.all([
    supabase
      .from("activity_feed")
      .select("event_type, event_at, project_id, entity_id, actor_id, label, detail")
      .eq("project_id", params.id)
      .order("event_at", { ascending: false })
      .limit(100),
    supabase.from("users").select("id, name, email"),
  ]);

  return (
    <ActivityList
      projectId={params.id}
      events={events ?? []}
      teammates={teammates ?? []}
    />
  );
}
