"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function ProjectNameEditor({
  projectId,
  initialName,
}: {
  projectId: string;
  initialName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setDraft(name);
    setError(null);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEdit() {
    setError(null);
    setEditing(false);
  }

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error: err } = await supabase
        .from("projects")
        .update({ name: trimmed })
        .eq("id", projectId);
      if (err) throw err;
      setName(trimmed);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") save();
    if (e.key === "Escape") cancelEdit();
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
            className="min-w-0 flex-1 border-b border-ink bg-transparent text-2xl font-semibold tracking-tight text-ink outline-none"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !draft.trim()}
            className="shrink-0 border border-rule bg-ink px-3 py-1 text-xs font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
          >
            {saving ? (
              <Bi cn="保存中…" en="Saving…" glossSize={0.78} />
            ) : (
              <Bi cn="保存" en="Save" glossSize={0.78} />
            )}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={saving}
            className="shrink-0 border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3 hover:text-ink"
          >
            <Bi cn="取消" en="Cancel" glossSize={0.78} />
          </button>
        </div>
        {error && (
          <p className="text-xs text-rust-ink">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{name}</h1>
      <button
        type="button"
        onClick={startEdit}
        className="opacity-0 transition group-hover:opacity-100 text-ink-3 hover:text-ink"
        title="编辑项目名称 / Edit project name"
      >
        <Glyph name="pencil" size={13} />
      </button>
    </div>
  );
}
