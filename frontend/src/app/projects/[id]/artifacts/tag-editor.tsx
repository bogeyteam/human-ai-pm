"use client";

/**
 * TagEditor — chip-list editor for a single artifact's tags.
 *
 * - Removable chips for tags already on the artifact (X to remove)
 * - Type-to-add input with autocomplete from the project's tag vocabulary
 * - "Create new tag" inline when no exact match exists
 * - "Suggest tags · AI 建议标签" button opens the AiTagProposals flow
 *
 * All CRUD goes through Supabase JS direct (RLS enforced) — never the backend.
 */

import * as React from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

import { AiTagProposals } from "./ai-tag-proposals";

export type TagRow = { id: string; name: string; kind: string };

type TagEditorProps = {
  artifactId: string;
  projectId: string;
  initialTags: TagRow[];
  allProjectTags: TagRow[];
  onChange: (tags: TagRow[]) => void;
};

const KIND_OPTIONS: { value: string; cn: string; en: string }[] = [
  { value: "topic", cn: "主题", en: "Topic" },
  { value: "phase", cn: "阶段", en: "Phase" },
  { value: "persona", cn: "角色", en: "Persona" },
  { value: "custom", cn: "自定义", en: "Custom" },
];

function kindLabel(k: string): { cn: string; en: string } {
  return KIND_OPTIONS.find((x) => x.value === k) ?? { cn: k, en: k };
}

export function TagEditor({
  artifactId,
  projectId,
  initialTags,
  allProjectTags,
  onChange,
}: TagEditorProps) {
  const [tags, setTags] = React.useState<TagRow[]>(initialTags);
  const [vocab, setVocab] = React.useState<TagRow[]>(allProjectTags);
  const [input, setInput] = React.useState("");
  const [newKind, setNewKind] = React.useState<string>("topic");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showAi, setShowAi] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  // Keep local state in sync if parent feeds new initialTags after a refresh
  React.useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  React.useEffect(() => {
    setVocab(allProjectTags);
  }, [allProjectTags]);

  const tagIds = React.useMemo(() => new Set(tags.map((t) => t.id)), [tags]);

  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const exactMatch = vocab.find((t) => t.name.toLowerCase() === lower) ?? null;
  const suggestions = React.useMemo(() => {
    if (!trimmed) return [];
    return vocab
      .filter((t) => !tagIds.has(t.id))
      .filter((t) => t.name.toLowerCase().includes(lower))
      .slice(0, 8);
  }, [vocab, trimmed, lower, tagIds]);

  function emit(next: TagRow[]) {
    setTags(next);
    onChange(next);
  }

  async function attachExisting(tag: TagRow) {
    if (tagIds.has(tag.id)) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("artifact_tags")
        .insert({ artifact_id: artifactId, tag_id: tag.id });
      if (error) throw error;
      emit([...tags, tag]);
      setInput("");
    } catch (err) {
      console.error("attachExisting failed:", err);
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function createAndAttach(name: string, kind: string) {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data: tagRow, error: insertErr } = await supabase
        .from("tags")
        .insert({ project_id: projectId, name: name.trim(), kind })
        .select("id, name, kind")
        .single();
      if (insertErr) throw insertErr;
      const created = tagRow as TagRow;
      const { error: linkErr } = await supabase
        .from("artifact_tags")
        .insert({ artifact_id: artifactId, tag_id: created.id });
      if (linkErr) throw linkErr;
      setVocab((prev) => [...prev, created]);
      emit([...tags, created]);
      setInput("");
    } catch (err) {
      console.error("createAndAttach failed:", err);
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  async function removeTag(tagId: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase
        .from("artifact_tags")
        .delete()
        .eq("artifact_id", artifactId)
        .eq("tag_id", tagId);
      if (error) throw error;
      emit(tags.filter((t) => t.id !== tagId));
    } catch (err) {
      console.error("removeTag failed:", err);
      setError(extractError(err));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (busy) return;
      if (exactMatch && !tagIds.has(exactMatch.id)) {
        void attachExisting(exactMatch);
      } else if (suggestions[0]) {
        void attachExisting(suggestions[0]);
      } else if (trimmed) {
        void createAndAttach(trimmed, newKind);
      }
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Micro>
          <Bi cn="标签" en="Tags" glossSize={0.78} />
        </Micro>
        <button
          type="button"
          onClick={() => setShowAi((v) => !v)}
          className="inline-flex items-center gap-1.5 border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
        >
          <Glyph name="ai" size={10} />
          <Bi cn="AI 建议标签" en="Suggest tags" glossSize={0.78} />
        </button>
      </div>

      {showAi && (
        <AiTagProposals
          artifactId={artifactId}
          existingTagNames={tags.map((t) => t.name.toLowerCase())}
          onClose={() => setShowAi(false)}
          onApplied={async () => {
            // Refresh tag list from supabase to pick up server-side inserts.
            const supabase = supabaseBrowser();
            const [{ data: rows }, { data: vocabRows }] = await Promise.all([
              supabase
                .from("artifact_tags")
                .select("tag:tags(id, name, kind)")
                .eq("artifact_id", artifactId),
              supabase
                .from("tags")
                .select("id, name, kind")
                .eq("project_id", projectId)
                .order("name"),
            ]);
            const flat: TagRow[] = ((rows ?? []) as Array<{ tag: TagRow | null }>)
              .map((r) => r.tag)
              .filter((t): t is TagRow => t !== null);
            emit(flat);
            if (vocabRows) setVocab(vocabRows as TagRow[]);
            setShowAi(false);
          }}
        />
      )}

      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && (
          <span className="text-xs italic text-ink-3">
            <Bi cn="（无标签）" en="(No tags yet)" glossSize={0.85} />
          </span>
        )}
        {tags.map((t) => {
          const k = kindLabel(t.kind);
          return (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 border border-rule bg-paper-2 px-2 py-0.5 text-xs text-ink-2"
              title={`${k.cn} · ${k.en}`}
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                {t.kind.slice(0, 3)}
              </span>
              <span className="font-sc">{t.name}</span>
              <button
                type="button"
                onClick={() => removeTag(t.id)}
                disabled={busy}
                aria-label={`Remove ${t.name}`}
                className="text-ink-3 transition hover:text-rust-ink disabled:opacity-40"
              >
                <Glyph name="cross" size={9} />
              </button>
            </span>
          );
        })}
      </div>

      <div className="relative">
        <div className="flex items-stretch gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder="Type to add or create tag · 输入以添加或创建标签"
            className="flex-1 border border-rule bg-paper px-3 py-1.5 text-sm text-ink outline-none transition focus:border-ink"
          />
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value)}
            disabled={busy}
            className="border border-rule bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ink"
            aria-label="Tag kind for new tag"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.cn} / {k.en}
              </option>
            ))}
          </select>
        </div>

        {focused && trimmed && (suggestions.length > 0 || !exactMatch) && (
          <ul className="absolute left-0 right-0 z-10 mt-1 max-h-56 overflow-y-auto border border-rule-ink bg-paper shadow-lg">
            {suggestions.map((s) => {
              const k = kindLabel(s.kind);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void attachExisting(s)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-ink-2 transition hover:bg-paper-2 hover:text-ink"
                  >
                    <span className="font-sc">{s.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                      {k.en}
                    </span>
                  </button>
                </li>
              );
            })}
            {!exactMatch && (
              <li>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void createAndAttach(trimmed, newKind)}
                  className="flex w-full items-center justify-between gap-2 border-t border-rule px-3 py-1.5 text-left text-sm text-ink transition hover:bg-clay-soft/40"
                >
                  <span>
                    <Bi cn="新建标签" en={`Create "${trimmed}"`} glossSize={0.78} />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-clay-ink">
                    {kindLabel(newKind).en}
                  </span>
                </button>
              </li>
            )}
          </ul>
        )}
      </div>

      {error && (
        <p className="border border-rust-soft bg-rust-soft/40 px-3 py-1.5 text-xs text-rust-ink">
          {error}
        </p>
      )}
    </div>
  );
}
