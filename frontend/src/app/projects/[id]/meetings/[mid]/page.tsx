import Link from "next/link";
import { notFound } from "next/navigation";

import { supabaseServer } from "@/lib/supabase-server";

import { MeetingDetailPanel } from "./meeting-detail-panel";

export default async function MeetingDetailPage({
  params,
}: {
  params: { id: string; mid: string };
}) {
  const supabase = supabaseServer();
  const [{ data: meeting }, { data: teammates }] = await Promise.all([
    supabase
      .from("meetings")
      .select(
        "id, project_id, type, scheduled_at, attendees, agenda, notes, ai_pre_brief, ai_post_summary",
      )
      .eq("id", params.mid)
      .single(),
    supabase
      .from("users")
      .select("id, name, email")
      .order("name", { ascending: true, nullsFirst: false }),
  ]);

  if (!meeting) notFound();

  // The `agenda` column is typed as `Json` in the generated DB types, but the
  // panel expects the narrower `{ markdown?: string } | null` shape that the
  // pre-brief writer produces. Narrow at the boundary instead of forcing the
  // panel's type to accept arbitrary JSON.
  const agenda =
    meeting.agenda && typeof meeting.agenda === "object" && !Array.isArray(meeting.agenda)
      ? (meeting.agenda as { markdown?: string })
      : null;

  return (
    <div className="space-y-4">
      <Link
        href={`/projects/${params.id}/meetings`}
        className="inline-block text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← All meetings
      </Link>
      <MeetingDetailPanel
        projectId={params.id}
        meeting={{ ...meeting, agenda }}
        teammates={teammates ?? []}
      />
    </div>
  );
}
