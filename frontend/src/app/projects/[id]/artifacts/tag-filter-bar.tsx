"use client";

/**
 * TagFilterBar — filter row above the artifact list.
 *
 * Controlled — state lives in the parent (artifacts-panel) so it can be
 * persisted into saved_views. This component just renders the UI and
 * fires callbacks.
 */

import * as React from "react";

import { Bi } from "@/components/almanac/Bi";
import { Chip } from "@/components/almanac/Chip";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";

export type SortKey = "newest" | "oldest" | "alpha" | "tagged";

const TYPE_CHIPS: { value: string; cn: string; en: string }[] = [
  { value: "doc", cn: "文档", en: "Doc" },
  { value: "link", cn: "链接", en: "Link" },
  { value: "image", cn: "图片", en: "Image" },
  { value: "dataset", cn: "数据", en: "Dataset" },
  { value: "decision", cn: "决策", en: "Decision" },
];

const SORTS: { value: SortKey; cn: string; en: string }[] = [
  { value: "newest", cn: "最新", en: "Newest" },
  { value: "oldest", cn: "最早", en: "Oldest" },
  { value: "alpha", cn: "字母", en: "Alphabetical" },
  { value: "tagged", cn: "标签多", en: "Most-tagged" },
];

const KIND_ORDER: string[] = ["topic", "phase", "persona", "custom"];
const KIND_LABELS: Record<string, { cn: string; en: string }> = {
  topic: { cn: "主题", en: "Topics" },
  phase: { cn: "阶段", en: "Phase" },
  persona: { cn: "角色", en: "Persona" },
  custom: { cn: "自定义", en: "Custom" },
};

export type TagFilterBarProps = {
  allTags: { id: string; name: string; kind: string }[];
  selectedTagIds: string[];
  onTagsChange: (ids: string[]) => void;
  selectedTypes: string[];
  onTypesChange: (types: string[]) => void;
  search: string;
  onSearchChange: (s: string) => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
};

export function TagFilterBar({
  allTags,
  selectedTagIds,
  onTagsChange,
  selectedTypes,
  onTypesChange,
  search,
  onSearchChange,
  sort,
  onSortChange,
}: TagFilterBarProps) {
  const [tagPickerOpen, setTagPickerOpen] = React.useState(false);
  const [localSearch, setLocalSearch] = React.useState(search);
  const pickerRef = React.useRef<HTMLDivElement>(null);

  // Debounce search 200ms upward to parent
  React.useEffect(() => {
    const t = setTimeout(() => {
      if (localSearch !== search) onSearchChange(localSearch);
    }, 200);
    return () => clearTimeout(t);
  }, [localSearch, search, onSearchChange]);

  // Reflect external search resets back into the local input value
  React.useEffect(() => {
    setLocalSearch(search);
  }, [search]);

  // Close picker on outside click
  React.useEffect(() => {
    if (!tagPickerOpen) return;
    function onClick(e: MouseEvent) {
      if (!pickerRef.current) return;
      if (!pickerRef.current.contains(e.target as Node)) {
        setTagPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [tagPickerOpen]);

  const grouped = React.useMemo(() => {
    const g: Record<string, { id: string; name: string; kind: string }[]> = {};
    for (const t of allTags) {
      const k = KIND_ORDER.includes(t.kind) ? t.kind : "custom";
      (g[k] ??= []).push(t);
    }
    return g;
  }, [allTags]);

  function toggleType(v: string) {
    onTypesChange(
      selectedTypes.includes(v)
        ? selectedTypes.filter((x) => x !== v)
        : [...selectedTypes, v],
    );
  }

  function toggleTag(id: string) {
    onTagsChange(
      selectedTagIds.includes(id)
        ? selectedTagIds.filter((x) => x !== id)
        : [...selectedTagIds, id],
    );
  }

  function clearAll() {
    onTagsChange([]);
    onTypesChange([]);
    setLocalSearch("");
    onSearchChange("");
  }

  const hasAnyFilter =
    selectedTagIds.length > 0 ||
    selectedTypes.length > 0 ||
    search.trim().length > 0;

  return (
    <div className="border-b border-rule bg-paper-2/40 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex flex-1 items-center gap-2" style={{ minWidth: 200 }}>
          <Glyph name="circle" size={11} color="var(--ink-3)" />
          <input
            type="search"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search title + content · 搜索标题与内容"
            className="flex-1 border border-rule bg-paper px-2 py-1 text-sm text-ink outline-none transition focus:border-ink"
          />
        </div>

        <label className="flex items-center gap-2">
          <Micro>
            <Bi cn="排序" en="Sort" glossSize={0.78} />
          </Micro>
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-ink"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.cn} / {s.en}
              </option>
            ))}
          </select>
        </label>

        {hasAnyFilter && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-ink-3 underline decoration-rule underline-offset-2 transition hover:text-ink"
          >
            <Bi cn="清除" en="Clear" glossSize={0.78} />
          </button>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Micro>
          <Bi cn="类型" en="Type" glossSize={0.78} />
        </Micro>
        {TYPE_CHIPS.map((t) => (
          <Chip
            key={t.value}
            cn={t.cn}
            en={t.en}
            active={selectedTypes.includes(t.value)}
            onClick={() => toggleType(t.value)}
          />
        ))}
      </div>

      <div className="relative mt-2 flex flex-wrap items-center gap-2" ref={pickerRef}>
        <Micro>
          <Bi cn="标签" en="Tags" glossSize={0.78} />
        </Micro>
        <button
          type="button"
          onClick={() => setTagPickerOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 border border-rule bg-paper px-2 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
        >
          <Bi
            cn={selectedTagIds.length > 0 ? `已选 ${selectedTagIds.length}` : "选择标签"}
            en={selectedTagIds.length > 0 ? `${selectedTagIds.length} selected` : "Pick tags"}
            glossSize={0.78}
          />
          <Glyph name="arrow" size={9} />
        </button>

        {selectedTagIds.slice(0, 6).map((id) => {
          const tag = allTags.find((t) => t.id === id);
          if (!tag) return null;
          return (
            <Chip
              key={id}
              cn={tag.name}
              en={tag.kind}
              active
              onClick={() => toggleTag(id)}
            />
          );
        })}
        {selectedTagIds.length > 6 && (
          <span className="font-mono text-[10px] text-ink-3">
            +{selectedTagIds.length - 6}
          </span>
        )}

        {tagPickerOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-80 overflow-y-auto border border-rule-ink bg-paper shadow-lg">
            {allTags.length === 0 ? (
              <p className="px-3 py-3 text-xs italic text-ink-3">
                <Bi
                  cn="该项目还没有标签"
                  en="No tags in this project yet"
                  glossSize={0.85}
                />
              </p>
            ) : (
              KIND_ORDER.map((kind) => {
                const tags = grouped[kind];
                if (!tags || tags.length === 0) return null;
                const k = KIND_LABELS[kind];
                return (
                  <div key={kind} className="border-b border-rule last:border-b-0">
                    <div className="bg-paper-2 px-3 py-1">
                      <Micro>
                        <Bi cn={k.cn} en={k.en} glossSize={0.78} />
                      </Micro>
                    </div>
                    <ul>
                      {tags.map((t) => {
                        const active = selectedTagIds.includes(t.id);
                        return (
                          <li key={t.id}>
                            <button
                              type="button"
                              onClick={() => toggleTag(t.id)}
                              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-paper-2 ${
                                active ? "text-ink" : "text-ink-2"
                              }`}
                            >
                              <span
                                className={`inline-block h-2.5 w-2.5 border ${
                                  active
                                    ? "border-clay-ink bg-clay-soft"
                                    : "border-rule bg-paper"
                                }`}
                                aria-hidden
                              />
                              <span className="font-sc">{t.name}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
