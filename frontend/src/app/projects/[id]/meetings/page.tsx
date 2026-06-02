import { supabaseServer } from "@/lib/supabase-server";

import { MeetingsList } from "./meetings-list";

export default async function MeetingsPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const [{ data: meetings }, { data: teammates }, { data: templates }] = await Promise.all([
    supabase
      .from("meetings")
      .select(
        "id, type, scheduled_at, attendees, agenda, notes, ai_pre_brief, ai_post_summary, template_id",
      )
      .eq("project_id", params.id)
      .order("scheduled_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("users")
      .select("id, name, email")
      .order("name", { ascending: true, nullsFirst: false }),
    supabase
      .from("meeting_templates")
      .select(
        "id, project_id, type, name, cadence, day_of_week, time_of_day, timezone, default_attendees, active, last_spawned_at, created_at, created_by",
      )
      .eq("project_id", params.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <MeetingsList
      projectId={params.id}
      initialMeetings={meetings ?? []}
      teammates={teammates ?? []}
      initialTemplates={templates ?? []}
    />
  );
}
