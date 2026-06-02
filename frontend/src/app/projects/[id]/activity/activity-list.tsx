"use client";

import type { Route } from "next";
import Link from "next/link";

import { AIText } from "@/components/almanac/AIText";
import { Bi } from "@/components/almanac/Bi";
import { Glyph, type GlyphName } from "@/components/almanac/Glyph";

// The activity_feed view exposes every column as nullable (Postgres views can't
// carry NOT NULL guarantees through to the generated types). We treat nulls as
// empty for display purposes.
type Event = {
  event_type: string | null;
  event_at: string | null;
  project_id: string | null;
  entity_id: string | null;
  actor_id: string | null;
  label: string | null;
  detail: string | null;
};

type Teammate = { id: string; name: string | null; email: string };

type TypeConfig = {
  glyph: GlyphName;
  color: string;
  verbCn: string;
  verbEn: string;
  isAi: boolean;
  link: (e: Event, projectId: string) => string | null;
};

const TYPES: Record<string, TypeConfig> = {
  task_created: {
    glyph: "square",
    color: "var(--ink-3)",
    verbCn: "新建任务",
    verbEn: "Task created",
    isAi: false,
    link: (_e, p) => `/projects/${p}/tasks`,
  },
  task_done: {
    glyph: "check",
    color: "var(--sage-ink)",
    verbCn: "完成任务",
    verbEn: "Task done",
    isAi: false,
    link: (_e, p) => `/projects/${p}/tasks`,
  },
  artifact_added: {
    glyph: "book",
    color: "var(--ink-3)",
    verbCn: "新增资料",
    verbEn: "Artifact added",
    isAi: false,
    link: (_e, p) => `/projects/${p}/artifacts`,
  },
  decision_logged: {
    glyph: "flag",
    color: "var(--clay)",
    verbCn: "记录决策",
    verbEn: "Decision logged",
    isAi: false,
    link: (_e, p) => `/projects/${p}/decisions`,
  },
  ai_accepted: {
    glyph: "sparkle",
    color: "var(--ai)",
    verbCn: "AI 已接受",
    verbEn: "AI suggestion accepted",
    isAi: true,
    link: () => null,
  },
  ai_rejected: {
    glyph: "sparkle",
    color: "var(--ai)",
    verbCn: "AI 已拒绝",
    verbEn: "AI suggestion rejected",
    isAi: true,
    link: () => null,
  },
  ai_reviewed: {
    glyph: "sparkle",
    color: "var(--ai)",
    verbCn: "AI 已审阅",
    verbEn: "AI suggestion reviewed",
    isAi: true,
    link: () => null,
  },
  finding_surfaced: {
    glyph: "star",
    color: "var(--ai)",
    verbCn: "跨任务发现",
    verbEn: "Finding surfaced",
    isAi: true,
    link: (_e, p) => `/projects/${p}/findings`,
  },
  meeting_scheduled: {
    glyph: "diamond",
    color: "var(--ochre-ink)",
    verbCn: "会议安排",
    verbEn: "Meeting scheduled",
    isAi: false,
    link: (e, p) => (e.entity_id ? `/projects/${p}/meetings/${e.entity_id}` : null),
  },
};

const FALLBACK: TypeConfig = {
  glyph: "bullet",
  color: "var(--ink-3)",
  verbCn: "事件",
  verbEn: "Event",
  isAi: false,
  link: () => null,
};

export function ActivityList({
  projectId,
  events,
  teammates,
}: {
  projectId: string;
  events: Event[];
  teammates: Teammate[];
}) {
  if (events.length === 0) {
    return (
      <div className="almanac">
        <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
          <p className="text-sm text-ink-3">
            <Bi cn="还没有活动" en="No activity yet" glossSize={0.78} />
          </p>
          <p className="mt-1 text-xs text-ink-4">
            <Bi
              cn="创建任务、记录决策、附加资料 — 这里按时间顺序显示"
              en="Create a task, log a decision, attach an artifact — actions show up here chronologically"
              glossSize={0.78}
            />
          </p>
        </div>
      </div>
    );
  }

  function actorName(id: string | null): string | null {
    if (!id) return null;
    const t = teammates.find((x) => x.id === id);
    return t?.name || t?.email || null;
  }

  return (
    <div className="almanac">
      <ul className="border-t border-rule">
        {events.map((e, i) => {
          const eventType = e.event_type ?? "";
          const config = TYPES[eventType] ?? FALLBACK;
          const href = config.link(e, projectId);
          const actor = actorName(e.actor_id);
          const label = e.label || "—";

          const content = (
            <div
              className="flex items-start gap-3 bg-paper px-4 py-4 transition hover:bg-paper-2"
              style={
                config.isAi
                  ? { borderLeft: "2px solid var(--ai-rule)" }
                  : undefined
              }
            >
              <div className="flex shrink-0 items-baseline gap-3" style={{ marginTop: 2 }}>
                <Glyph name={config.glyph} size={12} color={config.color} />
                <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  {e.event_at ? relativeTime(e.event_at) : ""}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  <Bi cn={config.verbCn} en={config.verbEn} glossSize={0.85} />
                  {actor ? ` · ${actor}` : ""}
                </div>
                {config.isAi ? (
                  <AIText
                    as="p"
                    className="mt-1 truncate font-serif text-sm italic text-ink"
                  >
                    {label}
                  </AIText>
                ) : (
                  <p className="mt-1 truncate font-sc text-sm text-ink">{label}</p>
                )}
                {e.detail && (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-3">{e.detail}</p>
                )}
              </div>
              {href && (
                <span className="shrink-0 self-center text-ink-4">
                  <Glyph name="arrow" size={14} />
                </span>
              )}
            </div>
          );
          return (
            <li key={`${e.entity_id ?? "anon"}-${eventType}-${i}`} className="border-b border-rule">
              {href ? (
                <Link href={href as Route} className="block">
                  {content}
                </Link>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.round((now - then) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
