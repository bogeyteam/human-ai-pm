"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AIText } from "@/components/almanac/AIText";
import { Bi } from "@/components/almanac/Bi";
import { Glyph, type GlyphName } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

import { TemplateEditor, type MeetingTemplate } from "./template-editor";

type Meeting = {
  id: string;
  type: string;
  scheduled_at: string | null;
  attendees: string[];
  notes: string | null;
  ai_pre_brief: string | null;
  ai_post_summary: string | null;
  template_id?: string | null;
};

type Teammate = { id: string; name: string | null; email: string };

type MeetingType = "daily_ops" | "weekly_retro" | "biweekly_planning" | "ad_hoc";

const TYPES: { value: MeetingType; cn: string; en: string; glyph: GlyphName }[] = [
  { value: "weekly_retro", cn: "周复盘", en: "Weekly retro", glyph: "circle" },
  {
    value: "biweekly_planning",
    cn: "双周规划",
    en: "Biweekly planning",
    glyph: "diamond",
  },
  { value: "daily_ops", cn: "日常 standup", en: "Daily ops", glyph: "bullet" },
  { value: "ad_hoc", cn: "临时", en: "Ad hoc", glyph: "ring" },
];

function typeMeta(t: string): { cn: string; en: string; glyph: GlyphName } {
  return (
    TYPES.find((x) => x.value === t) ?? {
      cn: t,
      en: t,
      glyph: "bullet" as GlyphName,
    }
  );
}

const TEMPLATE_TYPE_LABELS: Record<string, { cn: string; en: string }> = {
  biweekly_planning: { cn: "双周规划", en: "Biweekly Planning" },
  weekly_retro: { cn: "周回顾", en: "Weekly Retro" },
  daily_ops: { cn: "每日同步", en: "Daily Ops" },
  ad_hoc: { cn: "临时", en: "Ad-hoc" },
};

const CADENCE_LABELS: Record<string, { cn: string; en: string }> = {
  daily: { cn: "每天", en: "Daily" },
  weekly: { cn: "每周", en: "Weekly" },
  biweekly: { cn: "每两周", en: "Biweekly" },
};

const DAY_LABELS: Record<number, { cn: string; en: string }> = {
  0: { cn: "周日", en: "Sun" },
  1: { cn: "周一", en: "Mon" },
  2: { cn: "周二", en: "Tue" },
  3: { cn: "周三", en: "Wed" },
  4: { cn: "周四", en: "Thu" },
  5: { cn: "周五", en: "Fri" },
  6: { cn: "周六", en: "Sat" },
};

export function MeetingsList({
  projectId,
  initialMeetings,
  teammates,
  initialTemplates,
}: {
  projectId: string;
  initialMeetings: Meeting[];
  teammates: Teammate[];
  initialTemplates: MeetingTemplate[];
}) {
  const router = useRouter();
  const [meetings, setMeetings] = useState<Meeting[]>(initialMeetings);
  const [templates, setTemplates] = useState<MeetingTemplate[]>(initialTemplates);
  const [type, setType] = useState<MeetingType>("weekly_retro");
  const [scheduledAt, setScheduledAt] = useState<string>(defaultDateTime());
  const [selectedAttendees, setSelectedAttendees] = useState<string[]>(
    teammates.map((t) => t.id),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Templates UI state
  const [templatesOpen, setTemplatesOpen] = useState<boolean>(
    initialTemplates.length > 0,
  );
  const [showInactive, setShowInactive] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorExisting, setEditorExisting] = useState<MeetingTemplate | undefined>(
    undefined,
  );
  const [templateError, setTemplateError] = useState<string | null>(null);

  const activeTemplates = useMemo(
    () => templates.filter((t) => t.active),
    [templates],
  );
  const inactiveTemplates = useMemo(
    () => templates.filter((t) => !t.active),
    [templates],
  );
  const templatesById = useMemo(() => {
    const map = new Map<string, MeetingTemplate>();
    for (const t of templates) map.set(t.id, t);
    return map;
  }, [templates]);

  async function refreshTemplates() {
    const supabase = supabaseBrowser();
    const { data, error: fetchError } = await supabase
      .from("meeting_templates")
      .select(
        "id, project_id, type, name, cadence, day_of_week, time_of_day, timezone, default_attendees, active, last_spawned_at, created_at, created_by",
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (fetchError) {
      setTemplateError(extractError(fetchError));
      return;
    }
    setTemplates((data ?? []) as MeetingTemplate[]);
    router.refresh();
  }

  async function toggleActive(template: MeetingTemplate) {
    setTemplateError(null);
    const supabase = supabaseBrowser();
    const { error: updateError } = await supabase
      .from("meeting_templates")
      .update({ active: !template.active })
      .eq("id", template.id);
    if (updateError) {
      setTemplateError(extractError(updateError));
      return;
    }
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === template.id ? { ...t, active: !template.active } : t,
      ),
    );
    router.refresh();
  }

  function openCreateEditor() {
    setEditorExisting(undefined);
    setEditorOpen(true);
  }

  function openEditEditor(t: MeetingTemplate) {
    setEditorExisting(t);
    setEditorOpen(true);
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("meetings")
        .insert({
          project_id: projectId,
          type,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          attendees: selectedAttendees,
        })
        .select(
          "id, type, scheduled_at, attendees, agenda, notes, ai_pre_brief, ai_post_summary, template_id",
        )
        .single();
      if (error) throw error;
      setMeetings((prev) => [data as Meeting, ...prev]);
      router.push(`/projects/${projectId}/meetings/${data!.id}`);
    } catch (err) {
      console.error("Create meeting failed:", err);
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="almanac space-y-8">
      {/* ─── Recurring templates section ──────────────────────────── */}
      <section className="border border-rule bg-paper">
        <button
          type="button"
          onClick={() => setTemplatesOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-paper-2"
          aria-expanded={templatesOpen}
        >
          <div className="flex items-baseline gap-3">
            <Glyph
              name={templatesOpen ? "chevdown" : "chevron"}
              size={12}
              color="var(--ink-3)"
            />
            <Micro>
              <Bi
                cn="周期会议模板"
                en="Recurring templates"
                glossSize={0.78}
              />
            </Micro>
            <span className="font-mono text-[10.5px] tracking-wider text-ink-4">
              {activeTemplates.length.toString().padStart(2, "0")} active
              {inactiveTemplates.length > 0
                ? ` · ${inactiveTemplates.length.toString().padStart(2, "0")} inactive`
                : ""}
            </span>
          </div>
        </button>

        {templatesOpen && (
          <div className="space-y-3 border-t border-rule px-4 py-3">
            {templateError && (
              <div className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
                {templateError}
              </div>
            )}

            {activeTemplates.length === 0 && (
              <p className="border border-dashed border-rule bg-paper-2/60 px-4 py-6 text-center text-xs text-ink-3">
                <Bi
                  cn="暂无周期会议模板"
                  en="No recurring templates yet"
                  glossSize={0.78}
                />
                <br />
                <span className="text-ink-4">
                  Create one to auto-spawn meetings on a schedule · 创建后系统会按时自动生成会议
                </span>
              </p>
            )}

            {activeTemplates.length > 0 && (
              <ul className="border-t border-rule">
                {activeTemplates.map((t) => (
                  <TemplateRow
                    key={t.id}
                    template={t}
                    onEdit={() => openEditEditor(t)}
                    onToggle={() => toggleActive(t)}
                  />
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={openCreateEditor}
                className="border border-rule bg-paper px-3 py-1.5 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
              >
                <Glyph name="plus" size={11} />{" "}
                <Bi cn="新建模板" en="New template" glossSize={0.78} />
              </button>
              {inactiveTemplates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowInactive((s) => !s)}
                  className="text-xs text-ink-3 transition hover:text-ink"
                >
                  {showInactive ? (
                    <Bi
                      cn={`隐藏已停用 (${inactiveTemplates.length})`}
                      en="Hide inactive"
                      glossSize={0.78}
                    />
                  ) : (
                    <Bi
                      cn={`查看已停用 (${inactiveTemplates.length})`}
                      en="Show inactive"
                      glossSize={0.78}
                    />
                  )}
                </button>
              )}
            </div>

            {showInactive && inactiveTemplates.length > 0 && (
              <ul className="border-t border-rule pt-2">
                {inactiveTemplates.map((t) => (
                  <TemplateRow
                    key={t.id}
                    template={t}
                    onEdit={() => openEditEditor(t)}
                    onToggle={() => toggleActive(t)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* ─── Meetings list + new-meeting aside ────────────────────── */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <Micro>
              <Bi cn="会议" en="Meetings" glossSize={0.78} />
            </Micro>
            <span className="font-mono text-xs text-ink-3" data-tabular>
              {meetings.length.toString().padStart(2, "0")}
            </span>
          </div>
          {meetings.length === 0 ? (
            <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
              <p className="text-sm text-ink-3">
                <Bi
                  cn="还没有会议"
                  en="No meetings yet"
                  glossSize={0.78}
                />
              </p>
              <p className="mt-1 text-xs text-ink-4">
                Create one and the AI will draft an agenda from your project state · 创建后 AI 会基于项目状态起草议程
              </p>
            </div>
          ) : (
            <ul className="border-t border-rule">
              {meetings.map((m) => {
                const tpl = m.template_id ? templatesById.get(m.template_id) : null;
                const meta = typeMeta(m.type);
                return (
                  <li key={m.id} className="border-b border-rule">
                    <Link
                      href={`/projects/${projectId}/meetings/${m.id}`}
                      className="group flex items-start gap-3 bg-paper px-4 py-4 transition hover:bg-paper-2"
                    >
                      <Glyph
                        name={meta.glyph}
                        size={10}
                        color="var(--clay)"
                        style={{ marginTop: 8 }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <h3 className="truncate font-sc text-[15px] font-medium text-ink">
                            <Bi
                              cn={meta.cn}
                              en={meta.en}
                              glossSize={0.78}
                            />
                          </h3>
                          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                            {m.scheduled_at
                              ? new Date(m.scheduled_at).toLocaleString()
                              : "—"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-3">
                          <span>
                            {m.attendees.length}{" "}
                            <Bi
                              cn="参会人"
                              en={`attendee${m.attendees.length === 1 ? "" : "s"}`}
                              glossSize={0.78}
                            />
                          </span>
                          {tpl && (
                            <span
                              className="inline-flex items-center gap-1 border border-ai-rule bg-ai-soft px-2 py-0.5 text-[10.5px] font-medium text-ai"
                              title={`Spawned from template: ${tpl.name}`}
                            >
                              <Glyph name="return" size={10} />
                              <Bi
                                cn="来自模板"
                                en="from template"
                                glossSize={0.78}
                              />
                              <span className="text-ink-3">· {tpl.name}</span>
                            </span>
                          )}
                          {m.template_id && !tpl && (
                            <span className="inline-flex items-center gap-1 border border-ai-rule bg-ai-soft px-2 py-0.5 text-[10.5px] text-ai">
                              <Glyph name="return" size={10} />
                              <Bi
                                cn="来自模板"
                                en="from template"
                                glossSize={0.78}
                              />
                            </span>
                          )}
                          {m.ai_post_summary && (
                            <AIText className="line-clamp-1 text-xs text-ink-2">
                              · {m.ai_post_summary}
                            </AIText>
                          )}
                        </div>
                      </div>
                      <span className="self-center text-ink-4 transition group-hover:text-ink-2">
                        <Glyph name="arrow" size={14} />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <aside>
          <div className="mb-3">
            <Micro>
              <Bi cn="新建会议" en="New meeting" glossSize={0.78} />
            </Micro>
          </div>
          <form
            onSubmit={onCreate}
            className="space-y-3 border border-rule bg-paper p-4"
          >
            <label className="block">
              <Micro style={{ marginBottom: 6 }}>
                <Bi cn="类型" en="Type" glossSize={0.78} />
              </Micro>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MeetingType)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.cn} / {t.en}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <Micro style={{ marginBottom: 6 }}>
                <Bi cn="时间" en="Scheduled at" glossSize={0.78} />
              </Micro>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>

            <div>
              <Micro style={{ marginBottom: 6 }}>
                <Bi cn="参会人" en="Attendees" glossSize={0.78} />
              </Micro>
              <div className="space-y-1 border border-rule bg-paper p-2 text-xs text-ink-2">
                {teammates.length === 0 && (
                  <p className="text-ink-3">
                    <Bi
                      cn="暂无成员"
                      en="No teammates yet"
                      glossSize={0.78}
                    />
                  </p>
                )}
                {teammates.map((t) => (
                  <label key={t.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedAttendees.includes(t.id)}
                      onChange={(e) =>
                        setSelectedAttendees((prev) =>
                          e.target.checked
                            ? [...prev, t.id]
                            : prev.filter((id) => id !== t.id),
                        )
                      }
                    />
                    <span>{t.name || t.email}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
            >
              {submitting ? (
                <Bi cn="创建中…" en="Creating…" glossSize={0.78} />
              ) : (
                <Bi cn="创建会议" en="Create meeting" glossSize={0.78} />
              )}
            </button>
            {error && (
              <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
                {error}
              </p>
            )}
          </form>
        </aside>
      </div>

      {editorOpen && (
        <TemplateEditor
          projectId={projectId}
          existing={editorExisting}
          workspaceUsers={teammates}
          onClose={() => setEditorOpen(false)}
          onSaved={refreshTemplates}
        />
      )}
    </div>
  );
}

function TemplateRow({
  template,
  onEdit,
  onToggle,
}: {
  template: MeetingTemplate;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const dayLabel =
    template.cadence === "daily"
      ? null
      : template.day_of_week !== null
        ? DAY_LABELS[template.day_of_week] ?? {
            cn: `Day ${template.day_of_week}`,
            en: `Day ${template.day_of_week}`,
          }
        : null;
  const timeShort = template.time_of_day.slice(0, 5);
  const attendeeCount = template.default_attendees?.length ?? 0;
  const typeLbl = TEMPLATE_TYPE_LABELS[template.type] ?? {
    cn: template.type,
    en: template.type,
  };
  const cadenceLbl = CADENCE_LABELS[template.cadence] ?? {
    cn: template.cadence,
    en: template.cadence,
  };

  return (
    <li
      className={`flex flex-wrap items-center gap-3 border-b border-rule px-3 py-3 text-sm ${
        template.active ? "bg-paper" : "bg-paper-2/60 opacity-70"
      }`}
    >
      <span className="inline-flex items-center border border-rule bg-paper-3 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-2">
        <Bi cn={cadenceLbl.cn} en={cadenceLbl.en} glossSize={0.85} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-sc font-medium text-ink">{template.name}</p>
        <p className="truncate text-xs text-ink-3">
          <Bi cn={typeLbl.cn} en={typeLbl.en} glossSize={0.78} />
          {dayLabel && (
            <>
              {" · "}
              <Bi cn={dayLabel.cn} en={dayLabel.en} glossSize={0.78} />
            </>
          )}
          {" · "}
          <span className="font-mono">{timeShort}</span> {template.timezone} ·{" "}
          {attendeeCount}{" "}
          <Bi
            cn="参会人"
            en={`attendee${attendeeCount === 1 ? "" : "s"}`}
            glossSize={0.78}
          />
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="border border-rule bg-paper px-2 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
        >
          <Bi cn="编辑" en="Edit" glossSize={0.78} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className={`border px-2 py-1 text-xs transition ${
            template.active
              ? "border-ochre/40 bg-paper text-ochre-ink hover:bg-ochre-soft/50"
              : "border-sage-soft bg-paper text-sage-ink hover:bg-sage-soft/50"
          }`}
        >
          {template.active ? (
            <Bi cn="停用" en="Deactivate" glossSize={0.78} />
          ) : (
            <Bi cn="启用" en="Activate" glossSize={0.78} />
          )}
        </button>
      </div>
    </li>
  );
}

function defaultDateTime(): string {
  // Default to tomorrow at 10:00 local time.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
