import Link from "next/link";
import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase-server";

import { CoachingPanel, type PastSession } from "./coaching-panel";

export default async function CoachingPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS already filters coaching_sessions to user_id = auth.uid().
  // The explicit .eq("user_id", user.id) is defensive — privacy is sacred here.
  const { data: rows } = await supabase
    .from("coaching_sessions")
    .select("id, created_at, insights")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  const pastSessions: PastSession[] = (rows ?? []).map((r) => {
    const insightsObj =
      r.insights && typeof r.insights === "object" && !Array.isArray(r.insights)
        ? (r.insights as Record<string, unknown>)
        : {};
    const ratingRaw = insightsObj["user_rating"];
    let rating: "useful" | "not_useful" | null = null;
    if (ratingRaw === "useful" || ratingRaw === "not_useful") rating = ratingRaw;
    const closingNote =
      typeof insightsObj["closing_note"] === "string"
        ? (insightsObj["closing_note"] as string)
        : "";
    return {
      id: r.id,
      created_at: r.created_at,
      rating,
      preview: closingNote.slice(0, 80),
    };
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/projects"
        className="mb-6 inline-block text-sm text-neutral-500 hover:text-neutral-900"
      >
        ← All projects · 所有项目
      </Link>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Private space · 私密空间
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          🔒 Coaching · 教练
        </h1>
        <p className="mt-3 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          只有你能看到这里的内容。Only you can see this content. Team members
          and founders cannot read your coaching sessions.
        </p>
      </header>

      <CoachingPanel pastSessions={pastSessions} currentUserId={user.id} />
    </main>
  );
}
