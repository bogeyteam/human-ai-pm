import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase-server";

import { SessionView } from "./session-view";

export default async function CoachingSessionPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Belt-and-suspenders: RLS already restricts to user_id = auth.uid(),
  // but the explicit eq makes the privacy contract obvious in code review.
  const { data: row } = await supabase
    .from("coaching_sessions")
    .select("id, user_id, created_at, insights, transcript")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center gap-4 text-sm">
        <Link
          href="/projects"
          className="text-neutral-500 hover:text-neutral-900"
        >
          ← All projects · 所有项目
        </Link>
        <span className="text-neutral-300">·</span>
        <Link
          href="/coaching"
          className="text-neutral-500 hover:text-neutral-900"
        >
          All sessions · 所有会话
        </Link>
      </div>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          📖 Past session · 过去的会话
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {formatDate(row.created_at)}
        </h1>
        <p className="mt-3 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          只有你能看到这里的内容。Only you can see this content. Team members
          and founders cannot read your coaching sessions.
        </p>
      </header>

      <SessionView insights={row.insights} transcript={row.transcript} />
    </main>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
