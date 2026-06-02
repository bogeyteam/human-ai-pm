"use client";

/**
 * Manager Daily Brief (M21) — the Manager Agent's cross-feature
 * "what needs attention today" digest. On-demand (it costs an LLM call),
 * advisory and read-only. Items deep-link to the relevant tab.
 */

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";

import { AIText, Bi, Glyph, Micro } from "@/components/almanac";
import {
  type BriefItem,
  type DailyBriefResponse,
  generateDailyBrief,
  rateDailyBrief,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

const CATEGORY_META: Record<string, { cn: string; en: string; slug: string; glyph: string }> = {
  blocked: { cn: "受阻", en: "Blocked", slug: "tasks", glyph: "square" },
  stale: { cn: "停滞", en: "Stale", slug: "tasks", glyph: "ring" },
  finding: { cn: "发现", en: "Finding", slug: "findings", glyph: "arrow" },
  optimizer: { cn: "优化", en: "Optimizer", slug: "optimizer", glyph: "diamond" },
  meeting: { cn: "会议", en: "Meeting", slug: "meetings", glyph: "book" },
  general: { cn: "其它", en: "General", slug: "", glyph: "bullet" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "var(--rust)",
  medium: "var(--ochre)",
  low: "var(--ink-4)",
};

function priorityRank(p: string): number {
  return p === "high" ? 0 : p === "medium" ? 1 : 2;
}

export function DailyBriefCard({ projectId }: { projectId: string }) {
  const [brief, setBrief] = useState<DailyBriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState<boolean | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Restore the latest brief from manager_actions on mount so it survives tab switches.
  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase
      .from("manager_actions")
      .select("id, output, accepted_by_human, created_at")
      .eq("project_id", projectId)
      .eq("action_type", "daily_brief")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        const out = data.output as {
          headline?: string | null;
          items?: BriefItem[];
          summary?: string | null;
        } | null;
        if (!out) return;
        setBrief({
          manager_action_id: data.id,
          headline: out.headline ?? null,
          items: out.items ?? [],
          summary: out.summary ?? null,
          quiet: (out.items ?? []).length === 0,
        });
        setRated(data.accepted_by_human ?? null);
        setGeneratedAt(data.created_at as string);
      });
  }, [projectId]);

  async function run() {
    setLoading(true);
    setError(null);
    setRated(null);
    try {
      const result = await generateDailyBrief(projectId);
      setBrief(result);
      setGeneratedAt(new Date().toISOString());
    } catch (e) {
      setError(extractError(e));
    } finally {
      setLoading(false);
    }
  }

  async function rate(useful: boolean) {
    if (!brief) return;
    setRated(useful);
    try {
      await rateDailyBrief(projectId, { manager_action_id: brief.manager_action_id, useful });
    } catch {
      setRated(null); // allow retry on failure
    }
  }

  const items = brief?.items ? [...brief.items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)) : [];

  return (
    <section className="almanac border border-rule bg-paper" style={{ borderLeft: "2px solid var(--ai-rule)" }}>
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <div className="flex items-center gap-2">
          <Glyph name="sparkle" size={13} color="var(--ai)" />
          <Micro>
            <Bi cn="经理简报" en="Manager daily brief" glossSize={0.78} />
          </Micro>
        </div>
        <div className="flex items-center gap-3">
          {generatedAt && (
            <span className="font-mono text-[10px] text-ink-4">
              {new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="border border-rule bg-paper-2 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-2 transition hover:border-rule-ink hover:text-ink disabled:opacity-50"
          >
            {loading ? (
              <Bi cn="生成中…" en="Generating…" glossSize={0.85} />
            ) : brief ? (
              <Bi cn="刷新" en="Refresh" glossSize={0.85} />
            ) : (
              <Bi cn="生成今日简报" en="Generate today's brief" glossSize={0.85} />
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="px-4 py-3 text-sm text-rust-ink" role="alert">
          {error}
        </p>
      )}

      {!brief && !error && (
        <p className="px-4 py-6 text-center text-xs text-ink-3">
          <Bi
            cn="一键汇总受阻任务、停滞工作、未处理发现与即将到来的会议。"
            en="One synthesis across blocked tasks, stale work, open findings, and upcoming meetings."
            glossSize={0.78}
          />
        </p>
      )}

      {brief && (
        <div className="px-4 py-4">
          {brief.headline && (
            <AIText as="p" className="mb-3 font-serif text-base italic text-ink">
              {brief.headline}
            </AIText>
          )}

          {items.length > 0 ? (
            <ul className="space-y-px">
              {items.map((it, i) => (
                <BriefRow key={i} projectId={projectId} item={it} />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-ink-3">
              <Bi cn="今日无紧急事项。" en="All quiet today." glossSize={0.78} />
            </p>
          )}

          {brief.summary && <p className="mt-3 text-xs text-ink-2">{brief.summary}</p>}

          <div className="mt-4 flex items-center gap-3 border-t border-rule pt-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              <Bi cn="有用吗？" en="Useful?" glossSize={0.85} />
            </span>
            <button
              type="button"
              onClick={() => rate(true)}
              aria-pressed={rated === true}
              className={`px-2 py-1 font-mono text-[11px] ${rated === true ? "text-sage-ink" : "text-ink-3 hover:text-ink"}`}
            >
              <Glyph name="check" size={11} /> <Bi cn="有用" en="Yes" glossSize={0.85} />
            </button>
            <button
              type="button"
              onClick={() => rate(false)}
              aria-pressed={rated === false}
              className={`px-2 py-1 font-mono text-[11px] ${rated === false ? "text-rust-ink" : "text-ink-3 hover:text-ink"}`}
            >
              <Glyph name="cross" size={11} /> <Bi cn="一般" en="No" glossSize={0.85} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function BriefRow({ projectId, item }: { projectId: string; item: BriefItem }) {
  const meta = CATEGORY_META[item.category] ?? CATEGORY_META.general;
  const href = (meta.slug ? `/projects/${projectId}/${meta.slug}` : `/projects/${projectId}`) as Route;
  return (
    <li className="border-b border-rule py-2 last:border-b-0">
      <Link href={href} className="group block">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-[7px] w-[7px] shrink-0"
            style={{ background: PRIORITY_COLOR[item.priority] ?? "var(--ink-4)" }}
            aria-hidden="true"
          />
          <Glyph name={meta.glyph} size={11} color="var(--ink-3)" />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
            <Bi cn={meta.cn} en={meta.en} glossSize={0.85} />
          </span>
          <span className="ml-auto font-mono text-[10px] uppercase text-ink-4 opacity-0 transition group-hover:opacity-100">
            →
          </span>
        </div>
        <p className="mt-1 font-sc text-sm text-ink">{item.title}</p>
        {item.detail && <p className="mt-0.5 text-xs text-ink-2">{item.detail}</p>}
      </Link>
    </li>
  );
}
