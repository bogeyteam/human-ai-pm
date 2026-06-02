"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

/**
 * Editable project vision — shown only on the Overview tab.
 * Click-to-edit in place. Empty state offers an "Add vision" button
 * that expands the same textarea.
 */
export function VisionEditor({
  projectId,
  initialVision,
}: {
  projectId: string;
  initialVision: string | null;
}) {
  const router = useRouter();
  const [vision, setVision] = useState<string | null>(initialVision);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialVision ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(vision ?? "");
    setError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setError(null);
    setEditing(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const trimmed = draft.trim();
      const next = trimmed.length > 0 ? trimmed : null;
      const { error: err } = await supabase
        .from("projects")
        .update({ vision: next })
        .eq("id", projectId);
      if (err) throw err;
      setVision(next);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="border border-rule bg-paper">
      <div className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
        <Micro>
          <Bi cn="愿景" en="Vision" glossSize={0.78} />
        </Micro>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 text-xs text-ink-3 transition hover:text-ink"
          >
            <Glyph name="pencil" size={11} />
            <Bi cn={vision ? "编辑" : "添加"} en={vision ? "Edit" : "Add"} glossSize={0.78} />
          </button>
        )}
      </div>

      <div className="px-4 py-4">
        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={5}
              autoFocus
              placeholder="What does this project look like when it's done? · 项目做成之后是什么样子？"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-ink"
            />
            {error && (
              <p className="mt-2 border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
                {error}
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="border border-rule bg-paper px-3 py-1.5 text-sm text-ink-2 transition hover:bg-paper-3 hover:text-ink"
              >
                <Bi cn="取消" en="Cancel" glossSize={0.78} />
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="bg-ink px-4 py-1.5 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
              >
                {saving ? (
                  <Bi cn="保存中…" en="Saving…" glossSize={0.78} />
                ) : (
                  <Bi cn="保存" en="Save" glossSize={0.78} />
                )}
              </button>
            </div>
          </>
        ) : vision ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{vision}</p>
        ) : (
          <p className="text-sm italic text-ink-3">
            <Bi
              cn="还没有写愿景。点 添加 来记下这个项目的长期目标。"
              en="No vision yet. Click Add to set the long-term goal that anchors task generation."
              glossSize={0.78}
            />
          </p>
        )}
      </div>
    </section>
  );
}
