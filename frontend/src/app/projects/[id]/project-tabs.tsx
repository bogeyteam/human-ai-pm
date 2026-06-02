"use client";

/**
 * Project navigation chrome — Almanac 2-tier sidebar (desktop) +
 * single-row scrollable tab bar (mobile).
 *
 * Replaces the legacy horizontal tab strip. Visual rules per
 * `/tmp/design-bundle/ai-pm/project/system.jsx` (AppShell + NavItem).
 *
 * V1 deliberately omits count badges (open tasks, open findings, …).
 * They're nice-to-have and will be wired up in the next milestone via
 * Supabase queries on the client — see the `count` field on each item
 * below; the renderer already supports it.
 */

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Bi, Glyph, Kbd, Micro, Rule, ThemeToggle } from "@/components/almanac";

type ItemKey =
  | "overview"
  | "questions"
  | "tasks"
  | "findings"
  | "optimizer"
  | "meetings"
  | "artifacts"
  | "decisions"
  | "insights"
  | "activity";

/** Per-section open-item counts, keyed by ItemKey. Populated by the layout. */
export type NavCounts = Partial<Record<ItemKey, number>>;

type NavItemDef = {
  key: ItemKey;
  slug: string;
  cn: string;
  en: string;
  /** Optional keyboard hint (Daily section only). */
  kbd?: string;
  /** Optional count badge — not wired up in V1; reserved for the next milestone. */
  count?: number;
};

// M21 BET#4 — Open Question Engine. Gated by NEXT_PUBLIC_FEATURE_OQE (build-time;
// default ON — set the env to "off" to hide the tab). Leads the Daily section.
const QUESTIONS_ITEM: NavItemDef = {
  key: "questions",
  slug: "questions",
  cn: "问题",
  en: "Questions",
  kbd: "Q",
};
const OQE_ENABLED = process.env.NEXT_PUBLIC_FEATURE_OQE !== "off";

const DAILY: NavItemDef[] = [
  ...(OQE_ENABLED ? [QUESTIONS_ITEM] : []),
  { key: "tasks", slug: "tasks", cn: "任务", en: "Tasks", kbd: "T" },
  { key: "findings", slug: "findings", cn: "发现", en: "Findings", kbd: "F" },
  { key: "optimizer", slug: "optimizer", cn: "优化", en: "Optimizer", kbd: "O" },
  { key: "meetings", slug: "meetings", cn: "会议", en: "Meetings", kbd: "M" },
];

const REFERENCE: NavItemDef[] = [
  { key: "overview", slug: "", cn: "概览", en: "Overview" },
  { key: "artifacts", slug: "artifacts", cn: "资料", en: "Artifacts" },
  { key: "decisions", slug: "decisions", cn: "决策", en: "Decisions" },
  { key: "insights", slug: "insights", cn: "洞察", en: "Insights" },
  { key: "activity", slug: "activity", cn: "动态", en: "Activity" },
];

/** Merge live counts onto the static nav defs (B2 — count badges). */
function withCounts(items: NavItemDef[], counts?: NavCounts): NavItemDef[] {
  if (!counts) return items;
  return items.map((it) => (counts[it.key] != null ? { ...it, count: counts[it.key] } : it));
}

function resolveActive(pathname: string, base: string): ItemKey {
  // /projects/<id>           → overview
  // /projects/<id>/<slug>... → slug
  if (pathname === base || pathname === `${base}/`) return "overview";
  const tail = pathname.slice(base.length + 1).split("/")[0];
  const known: ItemKey[] = [
    "questions",
    "tasks",
    "findings",
    "optimizer",
    "meetings",
    "artifacts",
    "decisions",
    "insights",
    "activity",
  ];
  return (known.find((k) => k === tail) ?? "overview") as ItemKey;
}

function hrefFor(base: string, item: NavItemDef): Route {
  return (item.slug ? `${base}/${item.slug}` : base) as Route;
}

/* ────────────────────────────────────────────────────────────
   Desktop sidebar row.
   Visual rules:
   - Active: 2px clay left border, paper bg, ink text, weight 500.
   - Inactive: 2px transparent left border, ink-2 (daily) or ink-3 (ref).
   - Hover: paper-3 background.
   - Sharp corners — no rounded radii.
   ──────────────────────────────────────────────────────────── */
function SidebarItem({
  item,
  active,
  href,
  muted,
}: {
  item: NavItemDef;
  active: boolean;
  href: Route;
  muted?: boolean;
}) {
  const base = "flex items-center gap-2 px-2 pl-[10px] py-[5px] text-[13px] transition-colors";
  const state = active
    ? "border-l-2 border-clay bg-paper text-ink font-medium"
    : `border-l-2 border-transparent ${muted ? "text-ink-3" : "text-ink-2"} hover:bg-paper-3`;

  return (
    <Link href={href} className={`${base} ${state}`}>
      <span className="flex-1">
        <Bi cn={item.cn} en={item.en} glossSize={0.72} />
      </span>
      {item.count != null && (
        <span data-tabular className="font-mono text-[11px] text-ink-3">
          {item.count}
        </span>
      )}
      {item.kbd && (
        <span
          className="font-mono text-[10px] text-ink-4"
          style={{ opacity: active ? 1 : 0.6 }}
        >
          {item.kbd}
        </span>
      )}
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────
   Mobile tab row.
   Single horizontal scrollable strip. Active item gets a clay underline.
   ──────────────────────────────────────────────────────────── */
function MobileTab({
  item,
  active,
  href,
}: {
  item: NavItemDef;
  active: boolean;
  href: Route;
}) {
  const base = "shrink-0 whitespace-nowrap px-3 py-2 text-[13px] transition-colors -mb-px border-b-2";
  const state = active
    ? "border-clay text-ink font-medium"
    : "border-transparent text-ink-2 hover:text-ink";
  return (
    <Link href={href} className={`${base} ${state}`}>
      <Bi cn={item.cn} en={item.en} glossSize={0.72} />
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────
   ProjectNav — public entry point. Renders both surfaces and lets
   Tailwind `lg:` utilities pick which one appears.
   ──────────────────────────────────────────────────────────── */
export function ProjectNav({
  projectId,
  projectName,
  workspaceName,
  counts,
}: {
  projectId: string;
  projectName: string;
  workspaceName: string;
  counts?: NavCounts;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const base = `/projects/${projectId}`;
  const active = resolveActive(pathname, base);

  // B3 — wire up the keyboard hints already shown on Daily items (T/F/O/M).
  // Single-key jumps; ignored while typing into a field or with modifiers held.
  useEffect(() => {
    const byKey: Record<string, string> = {};
    for (const item of DAILY) {
      if (item.kbd) byKey[item.kbd.toLowerCase()] = item.slug;
    }
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      const slug = byKey[e.key.toLowerCase()];
      if (slug) {
        e.preventDefault();
        router.push(`${base}/${slug}` as Route);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [base, router]);

  return (
    <>
      <ProjectSidebar
        projectId={projectId}
        projectName={projectName}
        workspaceName={workspaceName}
        active={active}
        base={base}
        counts={counts}
      />
      <ProjectMobileTabs active={active} base={base} counts={counts} />
    </>
  );
}

/* ────────────────────────────────────────────────────────────
   Desktop sidebar — 220px column, paper-2 background.
   Hidden below lg (1024px).
   ──────────────────────────────────────────────────────────── */
export function ProjectSidebar({
  projectId: _projectId,
  projectName,
  workspaceName,
  active,
  base,
  counts,
}: {
  projectId: string;
  projectName: string;
  workspaceName: string;
  active: ItemKey;
  base: string;
  counts?: NavCounts;
}) {
  const daily = withCounts(DAILY, counts);
  const reference = withCounts(REFERENCE, counts);
  return (
    <aside
      className="hidden lg:flex w-[220px] shrink-0 flex-col bg-paper-2 border-r border-rule"
      style={{ padding: "20px 0 16px" }}
    >
      {/* Workspace + back link */}
      <div className="flex items-center gap-2 px-4 pb-[14px]">
        <div
          className="flex h-[22px] w-[22px] items-center justify-center bg-ink font-serif italic text-paper"
          style={{ fontSize: 14, fontWeight: 500, lineHeight: 1 }}
          aria-hidden="true"
        >
          a
        </div>
        <div className="text-[13px] font-medium truncate" title={workspaceName}>
          <Bi cn={workspaceName} en="" glossSize={0.75} />
        </div>
        <Link
          href="/projects"
          className="ml-auto text-ink-3 hover:text-ink"
          title="All projects"
          aria-label="All projects"
        >
          <Glyph name="larrow" size={12} />
        </Link>
      </div>
      <Rule />

      {/* Project switcher */}
      <div className="px-4" style={{ padding: "14px 16px 8px" }}>
        <Micro>Project · 项目</Micro>
        <div
          className="mt-[6px] flex items-center gap-[6px] text-[14px] font-medium text-ink"
        >
          <Glyph name="diamond" size={9} color="var(--clay)" />
          <span className="truncate" title={projectName}>
            <Bi cn={projectName} en="" glossSize={0.78} />
          </span>
        </div>
      </div>

      {/* Daily section */}
      <div style={{ padding: "14px 8px 6px 16px" }}>
        <Micro>Daily · 日常</Micro>
      </div>
      <nav className="flex flex-col gap-px" style={{ padding: "2px 8px" }}>
        {daily.map((item) => (
          <SidebarItem
            key={item.key}
            item={item}
            active={item.key === active}
            href={hrefFor(base, item)}
          />
        ))}
      </nav>

      {/* Reference section */}
      <div style={{ padding: "16px 8px 6px 16px" }}>
        <Micro>Reference · 资料</Micro>
      </div>
      <nav className="flex flex-col gap-px" style={{ padding: "2px 8px" }}>
        {reference.map((item) => (
          <SidebarItem
            key={item.key}
            item={item}
            active={item.key === active}
            href={hrefFor(base, item)}
            muted
          />
        ))}
      </nav>

      {/* Bottom hint + Coaching */}
      <div
        className="mt-auto border-t border-rule"
        style={{ padding: "16px 16px 0" }}
      >
        <Link
          href="/coaching"
          className="mb-3 flex items-center gap-2 text-[12px] text-ink-2 hover:text-ink"
          title="Coaching — private to you"
        >
          <span aria-hidden="true">🔒</span>
          <Bi cn="教练" en="Coaching" glossSize={0.78} />
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
            <span>
              <Bi cn="搜索 / 跳转" en="search" glossSize={0.78} />
            </span>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}

/* ────────────────────────────────────────────────────────────
   Mobile tab bar — visible below lg (1024px). Single-row, horizontal
   scroll. Active item gets a clay underline.
   ──────────────────────────────────────────────────────────── */
export function ProjectMobileTabs({
  active,
  base,
  counts,
}: {
  active: ItemKey;
  base: string;
  counts?: NavCounts;
}) {
  const items = withCounts([...DAILY, ...REFERENCE], counts);
  return (
    <nav
      className="lg:hidden flex overflow-x-auto border-b border-rule bg-paper-2"
      aria-label="Project sections"
    >
      {items.map((item) => (
        <MobileTab
          key={item.key}
          item={item}
          active={item.key === active}
          href={hrefFor(base, item)}
        />
      ))}
    </nav>
  );
}

/* Back-compat shim — the legacy export name in case anything else
   imports `ProjectTabs` (none today, but kept defensively). */
export const ProjectTabs = ProjectNav;
