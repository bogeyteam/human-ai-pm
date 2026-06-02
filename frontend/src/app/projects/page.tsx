import Link from "next/link";
import { redirect } from "next/navigation";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { supabaseServer } from "@/lib/supabase-server";

import { NewProjectForm } from "./new-project-form";

const STAGE_LABELS: Record<string, { cn: string; en: string }> = {
  discovery: { cn: "探索", en: "Discovery" },
  validation: { cn: "验证", en: "Validation" },
  launch: { cn: "上线", en: "Launch" },
  scale: { cn: "放大", en: "Scale" },
};

export default async function ProjectsPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: projects }, { data: workspaces }] = await Promise.all([
    supabase.from("users").select("workspace_id, name").eq("id", user.id).maybeSingle(),
    supabase
      .from("projects")
      .select("id, name, vision, current_stage, created_at, workspace_id")
      .order("created_at", { ascending: false }),
    supabase.from("workspaces").select("id, name").order("created_at", { ascending: true }),
  ]);

  const fallbackWorkspaceId =
    profile?.workspace_id ?? workspaces?.[0]?.id ?? null;
  const workspaceLookup = new Map<string, string>(
    (workspaces ?? []).map((w) => [w.id, w.name]),
  );
  const primaryWorkspaceName = workspaces?.[0]?.name ?? "—";

  return (
    <main className="almanac min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-10 flex items-end justify-between gap-6">
          <div>
            <Micro>
              <Bi cn="工作区" en="Workspace" glossSize={0.78} />
            </Micro>
            <h1 className="mt-2 font-serif text-3xl font-medium italic tracking-tight">
              {primaryWorkspaceName}
              {workspaces && workspaces.length > 1 ? (
                <span className="ml-3 font-sans text-base not-italic text-ink-3">
                  +{workspaces.length - 1} more
                </span>
              ) : null}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/coaching"
              className="inline-flex items-center gap-1.5 border border-rule bg-paper px-3 py-1.5 text-sm text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
            >
              <span aria-hidden>🔒</span>
              <Bi cn="教练" en="Coaching" glossSize={0.78} />
            </Link>
            <span className="text-sm text-ink-3">{profile?.name ?? user.email}</span>
          </div>
        </header>

        <section className="mb-12">
          <div className="mb-4 flex items-baseline justify-between">
            <Micro>
              <Bi cn="项目" en="Projects" glossSize={0.78} />
            </Micro>
            <span className="font-mono text-xs text-ink-3" data-tabular>
              {(projects ?? []).length.toString().padStart(2, "0")}
            </span>
          </div>

          {projects && projects.length > 0 ? (
            <ul className="border-t border-rule">
              {projects.map((p) => {
                const stage = STAGE_LABELS[p.current_stage] ?? {
                  cn: p.current_stage,
                  en: p.current_stage,
                };
                return (
                  <li key={p.id} className="border-b border-rule">
                    <Link
                      href={`/projects/${p.id}`}
                      className="group flex items-start gap-4 bg-paper px-4 py-5 transition hover:bg-paper-2"
                    >
                      <Glyph
                        name="diamond"
                        size={10}
                        color="var(--clay)"
                        style={{ marginTop: 8 }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <h3 className="truncate font-sc text-base font-medium text-ink">
                            {p.name}
                          </h3>
                          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                            <Bi cn={stage.cn} en={stage.en} glossSize={0.85} />
                          </span>
                        </div>
                        {p.vision && (
                          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-ink-2">
                            {p.vision}
                          </p>
                        )}
                        {workspaces && workspaces.length > 1 && (
                          <p className="mt-2 font-mono text-[10.5px] tracking-wider text-ink-4">
                            {workspaceLookup.get(p.workspace_id) ?? ""}
                          </p>
                        )}
                      </div>
                      <span className="self-center text-ink-4 transition group-hover:text-ink-2">
                        <Glyph name="arrow" size={14} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
              <p className="text-sm text-ink-3">
                <Bi cn="还没有项目" en="No projects yet" glossSize={0.78} />
              </p>
              <p className="mt-1 text-xs text-ink-4">
                Create your first one below · 创建第一个项目
              </p>
            </div>
          )}
        </section>

        {fallbackWorkspaceId && (
          <section>
            <div className="mb-4">
              <Micro>
                <Bi cn="新建项目" en="New project" glossSize={0.78} />
              </Micro>
            </div>
            <NewProjectForm workspaceId={fallbackWorkspaceId} />
          </section>
        )}
      </div>
    </main>
  );
}
