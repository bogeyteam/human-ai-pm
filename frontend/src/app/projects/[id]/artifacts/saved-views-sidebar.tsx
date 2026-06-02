"use client";

/**
 * SavedViewsSidebar — narrow left rail listing saved filter presets.
 *
 * Reads `saved_views` rows for the project; saves current filter state
 * as a new view; click a view → apply to parent. Mobile: collapsed
 * disclosure section above the list.
 */

import * as React from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

import type { SortKey } from "./tag-filter-bar";

export type ViewFilters = {
  tagIds: string[];
  types: string[];
  search: string;
  sort: SortKey;
};

export const EMPTY_FILTERS: ViewFilters = {
  tagIds: [],
  types: [],
  search: "",
  sort: "newest",
};

type SavedView = {
  id: string;
  name: string;
  filters: ViewFilters;
};

type SavedViewsSidebarProps = {
  projectId: string;
  currentFilters: ViewFilters;
  onApplyView: (filters: ViewFilters) => void;
};

function isViewFilters(v: unknown): v is ViewFilters {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.tagIds) &&
    Array.isArray(r.types) &&
    typeof r.search === "string" &&
    typeof r.sort === "string"
  );
}

function normalizeFilters(raw: unknown): ViewFilters {
  if (isViewFilters(raw)) {
    return {
      tagIds: raw.tagIds.filter((x): x is string => typeof x === "string"),
      types: raw.types.filter((x): x is string => typeof x === "string"),
      search: raw.search,
      sort: ((["newest", "oldest", "alpha", "tagged"] as const).includes(
        raw.sort as SortKey,
      )
        ? raw.sort
        : "newest") as SortKey,
    };
  }
  return { ...EMPTY_FILTERS };
}

export function SavedViewsSidebar({
  projectId,
  currentFilters,
  onApplyView,
}: SavedViewsSidebarProps) {
  const [views, setViews] = React.useState<SavedView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);

  const fetchViews = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("saved_views")
        .select("id, name, filters")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Array<{
        id: string;
        name: string;
        filters: unknown;
      }>;
      setViews(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          filters: normalizeFilters(r.filters),
        })),
      );
    } catch (err) {
      console.error("fetchViews failed:", err);
      setError(extractError(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  React.useEffect(() => {
    void fetchViews();
  }, [fetchViews]);

  async function saveView(name: string) {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      // ViewFilters → Json: the saved_views.filters column is jsonb. Supabase
      // typegen exposes a strict Json union that doesn't accept a plain
      // Record, so we round-trip through a generic JSON-safe payload.
      const payload: Record<string, unknown> = {
        tagIds: currentFilters.tagIds,
        types: currentFilters.types,
        search: currentFilters.search,
        sort: currentFilters.sort,
      };
      const { error } = await supabase
        .from("saved_views")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ project_id: projectId, name: name.trim(), filters: payload as any });
      if (error) throw error;
      setNewName("");
      setNaming(false);
      await fetchViews();
    } catch (err) {
      console.error("saveView failed:", err);
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteView(id: string, name: string) {
    if (!confirm(`Delete view "${name}"? · 删除视图 "${name}"?`)) return;
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.from("saved_views").delete().eq("id", id);
      if (error) throw error;
      await fetchViews();
    } catch (err) {
      console.error("deleteView failed:", err);
      setError(extractError(err));
    }
  }

  return (
    <aside className="border border-rule bg-paper">
      <div className="flex items-center justify-between border-b border-rule px-3 py-2">
        <Micro>
          <Bi cn="视图" en="Saved views" glossSize={0.78} />
        </Micro>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="text-ink-3 transition hover:text-ink lg:hidden"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          <Glyph name="arrow" size={11} />
        </button>
      </div>

      <div className={`${collapsed ? "hidden lg:block" : "block"}`}>
        <ul className="border-b border-rule">
          <li>
            <button
              type="button"
              onClick={() => onApplyView({ ...EMPTY_FILTERS })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink-2 transition hover:bg-paper-2 hover:text-ink"
            >
              <Glyph name="diamond" size={8} color="var(--ink-3)" />
              <span className="font-sc">
                <Bi cn="全部" en="All artifacts" glossSize={0.78} />
              </span>
            </button>
          </li>
          {loading && (
            <li className="px-3 py-2 text-xs italic text-ink-3">
              <Bi cn="加载中…" en="Loading…" glossSize={0.85} />
            </li>
          )}
          {!loading && views.length === 0 && (
            <li className="px-3 py-2 text-xs italic text-ink-3">
              <Bi cn="无视图" en="No saved views" glossSize={0.85} />
            </li>
          )}
          {views.map((v) => (
            <li key={v.id} className="group flex items-center border-t border-rule">
              <button
                type="button"
                onClick={() => onApplyView(v.filters)}
                className="flex-1 truncate px-3 py-2 text-left text-sm text-ink-2 transition hover:bg-paper-2 hover:text-ink"
                title={v.name}
              >
                <span className="font-sc">{v.name}</span>
              </button>
              <button
                type="button"
                onClick={() => void deleteView(v.id, v.name)}
                aria-label={`Delete ${v.name}`}
                className="hidden px-2 py-2 text-ink-3 transition hover:text-rust-ink group-hover:inline-flex"
              >
                <Glyph name="cross" size={10} />
              </button>
            </li>
          ))}
        </ul>

        <div className="px-3 py-2">
          {naming ? (
            <div className="space-y-2">
              <input
                type="text"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="View name · 视图名"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void saveView(newName);
                  } else if (e.key === "Escape") {
                    setNaming(false);
                    setNewName("");
                  }
                }}
                className="w-full border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-ink"
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void saveView(newName)}
                  disabled={saving || !newName.trim()}
                  className="flex-1 bg-ink px-2 py-1 text-[11px] font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
                >
                  <Bi cn="保存" en="Save" glossSize={0.78} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNaming(false);
                    setNewName("");
                  }}
                  className="border border-rule bg-paper px-2 py-1 text-[11px] text-ink-2 transition hover:bg-paper-3"
                >
                  <Bi cn="取消" en="Cancel" glossSize={0.78} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="w-full border border-dashed border-rule bg-paper px-2 py-1.5 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-2 hover:text-ink"
            >
              + <Bi cn="保存当前视图" en="Save current view" glossSize={0.78} />
            </button>
          )}
          {error && (
            <p className="mt-2 border border-rust-soft bg-rust-soft/40 px-2 py-1 text-[11px] text-rust-ink">
              {error}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
