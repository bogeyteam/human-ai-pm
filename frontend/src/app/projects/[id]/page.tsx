import type { Route } from "next";
import Link from "next/link";

import { AIText } from "@/components/almanac/AIText";
import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { supabaseServer } from "@/lib/supabase-server";

import { DailyBriefCard } from "./daily-brief-card";
import { PreferencesEditor } from "./preferences-editor";
import { VisionEditor } from "./vision-editor";

export default async function ProjectOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = supabaseServer();
  const [
    { data: project },
    { count: taskCount },
    { data: activeTasks },
    { count: artifactCount },
    { data: recentArtifacts },
    { count: openFindingCount },
    { data: recentFindings },
    { data: recentActions },
  ] = await Promise.all([
    supabase
      .from("projects")
      .select("id, current_stage, preferences, vision")
      .eq("id", params.id)
      .single(),
    supabase
      .from("tasks")
      .select("*", { count: "exact", head: true })
      .eq("project_id", params.id),
    supabase
      .from("tasks")
      .select("id, title, status, owner_id, estimated_hours, created_by, users:owner_id(name, email)")
      .eq("project_id", params.id)
      .in("status", ["in_progress", "blocked", "ready"])
      .order("priority", { ascending: false })
      .limit(5),
    supabase
      .from("artifacts")
      .select("*", { count: "exact", head: true })
      .eq("project_id", params.id),
    supabase
      .from("artifacts")
      .select("id, title, type, created_at")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("findings")
      .select("*", { count: "exact", head: true })
      .eq("project_id", params.id)
      .in("status", ["new", "acknowledged"]),
    supabase
      .from("findings")
      .select(
        "id, how_to_use, status, target_task:tasks!findings_target_task_id_fkey(id, title)",
      )
      .eq("project_id", params.id)
      .in("status", ["new", "acknowledged"])
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("manager_actions")
      .select("id, action_type, accepted_by_human, created_at")
      .eq("project_id", params.id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const isEmpty = (taskCount ?? 0) === 0 && (recentArtifacts?.length ?? 0) === 0;

  return (
    <div className="almanac space-y-8">
      <DailyBriefCard projectId={params.id} />

      <PreferencesEditor
        projectId={params.id}
        initialStage={project?.current_stage ?? "discovery"}
        initialPreferences={
          (project?.preferences as { speed?: number; quality?: number; cost?: number }) ?? {}
        }
      />

      <VisionEditor
        projectId={params.id}
        initialVision={(project as { vision?: string | null } | null)?.vision ?? null}
      />

      {isEmpty ? (
        <ColdStart projectId={params.id} />
      ) : (
        <>
          <section className="grid grid-cols-3 gap-3">
            <Tile
              labelCn="任务"
              labelEn="Tasks"
              value={taskCount ?? 0}
              href={`/projects/${params.id}/tasks`}
            />
            <Tile
              labelCn="待处理发现"
              labelEn="Open findings"
              value={openFindingCount ?? 0}
              href={`/projects/${params.id}/findings`}
            />
            <Tile
              labelCn="资料"
              labelEn="Artifacts"
              value={artifactCount ?? 0}
              href={`/projects/${params.id}/artifacts`}
            />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Panel
              titleCn="进行中任务"
              titleEn="Active tasks"
              href={`/projects/${params.id}/tasks`}
            >
              {activeTasks && activeTasks.length > 0 ? (
                <ul className="border-t border-rule">
                  {activeTasks.map((t) => {
                    const isAi = t.created_by === "ai";
                    const owner =
                      (t.users as { name?: string | null; email?: string } | null)?.name ||
                      (t.users as { name?: string | null; email?: string } | null)?.email ||
                      "unassigned";
                    return (
                      <li
                        key={t.id}
                        className="border-b border-rule px-3 py-3"
                        style={
                          isAi ? { borderLeft: "2px solid var(--ai-rule)" } : undefined
                        }
                      >
                        {isAi ? (
                          <AIText as="p" className="font-serif text-sm italic text-ink">
                            {t.title}
                          </AIText>
                        ) : (
                          <p className="font-sc text-sm text-ink">{t.title}</p>
                        )}
                        <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                          {t.status} · {owner}
                          {t.estimated_hours ? ` · ${t.estimated_hours}h` : ""}
                          {isAi ? " · AI" : ""}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>
                  <Bi
                    cn="暂无进行中任务。可在「任务」中由头脑风暴生成"
                    en="No active tasks. Generate some from a brainstorm in the Tasks tab"
                    glossSize={0.78}
                  />
                </Empty>
              )}
            </Panel>

            <Panel
              titleCn="待处理发现"
              titleEn="Open findings"
              href={`/projects/${params.id}/findings`}
            >
              {recentFindings && recentFindings.length > 0 ? (
                <ul className="border-t border-rule">
                  {recentFindings.map((f) => (
                    <li
                      key={f.id}
                      className="border-b border-rule px-3 py-3"
                      style={{ borderLeft: "2px solid var(--ai-rule)" }}
                    >
                      <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                        <Glyph name="arrow" size={10} />{" "}
                        {(f.target_task as { title?: string } | null)?.title || "(task)"}
                      </p>
                      <AIText as="p" className="mt-1 line-clamp-2 font-serif text-sm italic text-ink-2">
                        {f.how_to_use}
                      </AIText>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  <Bi
                    cn="尚无发现。完成附带资料的任务后运行「跨任务发现」"
                    en="No open findings. Mark some tasks done with artifacts attached and click Run discovery"
                    glossSize={0.78}
                  />
                </Empty>
              )}
            </Panel>

            <Panel
              titleCn="近期资料"
              titleEn="Recent artifacts"
              href={`/projects/${params.id}/artifacts`}
            >
              {recentArtifacts && recentArtifacts.length > 0 ? (
                <ul className="border-t border-rule">
                  {recentArtifacts.map((a) => (
                    <li key={a.id} className="border-b border-rule px-3 py-3">
                      <p className="font-sc text-sm text-ink">{a.title}</p>
                      <p className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                        {a.type}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>
                  <Bi cn="还没有资料" en="No artifacts yet" glossSize={0.78} />
                </Empty>
              )}
            </Panel>
          </div>

          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <Micro>
                <Bi cn="近期 AI 活动" en="Recent AI activity" glossSize={0.78} />
              </Micro>
              <span className="font-mono text-xs text-ink-3" data-tabular>
                {(recentActions ?? []).length.toString().padStart(2, "0")}
              </span>
            </div>
            {recentActions && recentActions.length > 0 ? (
              <ul className="border-t border-rule bg-paper">
                {recentActions.map((a) => {
                  const status =
                    a.accepted_by_human === null
                      ? { cn: "待审", en: "Pending" }
                      : a.accepted_by_human
                        ? { cn: "已接受", en: "Accepted" }
                        : { cn: "已拒绝", en: "Rejected" };
                  return (
                    <li
                      key={a.id}
                      className="flex items-center justify-between border-b border-rule px-4 py-3"
                      style={{ borderLeft: "2px solid var(--ai-rule)" }}
                    >
                      <div className="flex items-center gap-3">
                        <Glyph name="sparkle" size={12} color="var(--ai)" />
                        <Micro>{a.action_type}</Micro>
                      </div>
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                        <Bi cn={status.cn} en={status.en} glossSize={0.85} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
                <p className="text-sm text-ink-3">
                  <Bi cn="还没有 AI 活动" en="No AI activity yet" glossSize={0.78} />
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Tile({
  labelCn,
  labelEn,
  value,
  href,
}: {
  labelCn: string;
  labelEn: string;
  value: number;
  href: string;
}) {
  return (
    <Link
      href={href as Route}
      className="block border border-rule bg-paper p-4 transition hover:border-rule-ink hover:bg-paper-2"
    >
      <Micro>
        <Bi cn={labelCn} en={labelEn} glossSize={0.78} />
      </Micro>
      <p className="mt-2 font-mono text-2xl text-ink" data-tabular>
        {value.toString().padStart(2, "0")}
      </p>
    </Link>
  );
}

function Panel({
  titleCn,
  titleEn,
  href,
  children,
}: {
  titleCn: string;
  titleEn: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <Micro>
          <Bi cn={titleCn} en={titleEn} glossSize={0.78} />
        </Micro>
        <Link
          href={href as Route}
          className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 transition hover:text-ink"
        >
          <Bi cn="查看" en="View" glossSize={0.85} /> →
        </Link>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-rule bg-paper-2/60 px-4 py-6 text-center text-xs text-ink-3">
      {children}
    </div>
  );
}

function ColdStart({ projectId }: { projectId: string }) {
  return (
    <section className="border border-rule bg-ochre-soft p-8 text-center">
      <Micro>
        <Bi cn="开始" en="Get started" glossSize={0.78} />
      </Micro>
      <h2 className="mt-2 font-serif text-xl italic text-ink">
        <Bi cn="空项目。最快的入场路径" en="Empty project — the fastest way in" glossSize={0.78} />
      </h2>
      <ol className="mx-auto mt-5 max-w-xl space-y-3 text-left text-sm text-ink-2">
        <li className="flex gap-3">
          <span className="font-mono text-xs text-ink-3" data-tabular>
            01
          </span>
          <span>
            <Link
              href={`/projects/${projectId}/tasks`}
              className="text-clay-ink underline decoration-rule underline-offset-2 hover:decoration-clay-ink"
            >
              <Bi cn="打开「任务」标签" en="Open the Tasks tab" glossSize={0.78} />
            </Link>{" "}
            <Bi
              cn="，粘贴一段项目想法后点「从头脑风暴生成」"
              en="and click Generate from brainstorm with a paragraph about your project"
              glossSize={0.78}
            />
            。
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-xs text-ink-3" data-tabular>
            02
          </span>
          <span>
            <Bi
              cn="接受你认可的提案，拒绝时附上理由，AI 会学到你的风格"
              en="Accept the proposals you like; reject the rest with reasons so the AI learns your style"
              glossSize={0.78}
            />
            。
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-xs text-ink-3" data-tabular>
            03
          </span>
          <span>
            <Bi cn="在" en="Add a few artifacts (docs/links) in the" glossSize={0.78} />{" "}
            <Link
              href={`/projects/${projectId}/artifacts`}
              className="text-clay-ink underline decoration-rule underline-offset-2 hover:decoration-clay-ink"
            >
              <Bi cn="资料" en="Artifacts tab" glossSize={0.78} />
            </Link>{" "}
            <Bi
              cn="中添加文档/链接，让跨任务发现有素材可用"
              en="so cross-task discovery has something to work with"
              glossSize={0.78}
            />
            。
          </span>
        </li>
        <li className="flex gap-3">
          <span className="font-mono text-xs text-ink-3" data-tabular>
            04
          </span>
          <span>
            <Bi cn="在" en="Log a couple of decisions in the" glossSize={0.78} />{" "}
            <Link
              href={`/projects/${projectId}/decisions`}
              className="text-clay-ink underline decoration-rule underline-offset-2 hover:decoration-clay-ink"
            >
              <Bi cn="决策" en="Decisions tab" glossSize={0.78} />
            </Link>{" "}
            <Bi
              cn="中记录几条决策，让 AI 理解「我们为什么这么选」"
              en="— the AI uses them to understand why we made this choice"
              glossSize={0.78}
            />
            。
          </span>
        </li>
      </ol>
    </section>
  );
}
