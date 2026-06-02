"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { MarkdownView } from "@/components/almanac/MarkdownView";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

import {
  EMPTY_FILTERS,
  SavedViewsSidebar,
  type ViewFilters,
} from "./saved-views-sidebar";
import { TagEditor, type TagRow } from "./tag-editor";
import { TagFilterBar, type SortKey } from "./tag-filter-bar";

type Artifact = {
  id: string;
  task_id: string | null;
  project_id: string;
  type: string;
  title: string;
  content: string | null;
  storage_url: string | null;
  created_at: string;
  tasks: { id: string; title: string } | null;
  tags: TagRow[];
};

type ArtifactType = "doc" | "link" | "decision" | "image" | "dataset";

const TYPES: { value: ArtifactType; cn: string; en: string }[] = [
  { value: "doc", cn: "文档", en: "Doc" },
  { value: "link", cn: "链接", en: "Link" },
  { value: "image", cn: "图片", en: "Image" },
  { value: "dataset", cn: "数据", en: "Dataset" },
  { value: "decision", cn: "决策", en: "Decision" },
];

function typeLabel(t: string): { cn: string; en: string } {
  return TYPES.find((x) => x.value === t) ?? { cn: t, en: t };
}

export function ArtifactsPanel({
  projectId,
  workspaceId,
  initialArtifacts,
  initialAllTags,
  tasks,
}: {
  projectId: string;
  workspaceId: string;
  initialArtifacts: Artifact[];
  initialAllTags: TagRow[];
  tasks: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [allTags, setAllTags] = useState<TagRow[]>(initialAllTags);
  const [taskId, setTaskId] = useState<string>("");
  const [editing, setEditing] = useState<Artifact | null>(null);
  const [type, setType] = useState<ArtifactType>("doc");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter state — owned here so SavedViewsSidebar can persist it.
  const [filters, setFilters] = useState<ViewFilters>(EMPTY_FILTERS);

  async function refreshAllTags() {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("tags")
      .select("id, name, kind")
      .eq("project_id", projectId)
      .order("name");
    if (data) setAllTags(data as TagRow[]);
  }

  async function refreshArtifactTags(artifactId: string): Promise<TagRow[]> {
    const supabase = supabaseBrowser();
    const { data } = await supabase
      .from("artifact_tags")
      .select("tag:tags(id, name, kind)")
      .eq("artifact_id", artifactId);
    const flat: TagRow[] = ((data ?? []) as unknown as Array<{ tag: TagRow | null }>)
      .map((r) => r.tag)
      .filter((t): t is TagRow => t !== null);
    setArtifacts((prev) =>
      prev.map((a) => (a.id === artifactId ? { ...a, tags: flat } : a)),
    );
    return flat;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      let storage_url: string | null = null;

      const { data: row, error: insertErr } = await supabase
        .from("artifacts")
        .insert({
          project_id: projectId,
          task_id: taskId || null,
          type,
          title: title.trim(),
          content: content.trim() || null,
        })
        .select(
          "id, task_id, project_id, type, title, content, storage_url, created_at, tasks(id, title)",
        )
        .single();
      if (insertErr) throw insertErr;

      if (file && row) {
        const path = `${workspaceId}/${row.id}/${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from("artifacts")
          .upload(path, file);
        if (uploadErr) throw uploadErr;
        storage_url = path;
        const { error: patchErr } = await supabase
          .from("artifacts")
          .update({ storage_url })
          .eq("id", row.id);
        if (patchErr) throw patchErr;
      }

      const newRow: Artifact = {
        ...(row as Omit<Artifact, "tags">),
        storage_url,
        tags: [],
      };
      setArtifacts((prev) => [newRow, ...prev]);
      setTitle("");
      setContent("");
      setFile(null);
      router.refresh();
    } catch (err) {
      console.error("Artifact save failed:", err);
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // Derived: filtered + sorted list
  const visible = useMemo(() => {
    const { tagIds, types, search, sort } = filters;
    const lower = search.trim().toLowerCase();
    let out = artifacts.filter((a) => {
      if (types.length > 0 && !types.includes(a.type)) return false;
      if (tagIds.length > 0) {
        const ids = new Set(a.tags.map((t) => t.id));
        // Match-any semantics: artifact has at least one of the filter tags.
        if (!tagIds.some((id) => ids.has(id))) return false;
      }
      if (lower) {
        const hay = `${a.title} ${a.content ?? ""}`.toLowerCase();
        if (!hay.includes(lower)) return false;
      }
      return true;
    });
    switch (sort) {
      case "oldest":
        out = [...out].sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "alpha":
        out = [...out].sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "tagged":
        out = [...out].sort((a, b) => b.tags.length - a.tags.length);
        break;
      case "newest":
      default:
        out = [...out].sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
    }
    return out;
  }, [artifacts, filters]);

  return (
    <div className="almanac grid grid-cols-1 gap-6 lg:grid-cols-[160px_1fr_320px]">
      <SavedViewsSidebar
        projectId={projectId}
        currentFilters={filters}
        onApplyView={(f) => setFilters(f)}
      />

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <Micro>
            <Bi cn="资料" en="Artifacts" glossSize={0.78} />
          </Micro>
          <span className="font-mono text-xs text-ink-3" data-tabular>
            {visible.length.toString().padStart(2, "0")} / {artifacts.length.toString().padStart(2, "0")}
          </span>
        </div>

        <div className="border border-rule bg-paper">
          <TagFilterBar
            allTags={allTags}
            selectedTagIds={filters.tagIds}
            onTagsChange={(tagIds) => setFilters((f) => ({ ...f, tagIds }))}
            selectedTypes={filters.types}
            onTypesChange={(types) => setFilters((f) => ({ ...f, types }))}
            search={filters.search}
            onSearchChange={(search) => setFilters((f) => ({ ...f, search }))}
            sort={filters.sort as SortKey}
            onSortChange={(sort) => setFilters((f) => ({ ...f, sort }))}
          />

          {visible.length === 0 ? (
            <div className="border-t border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
              <p className="text-sm text-ink-3">
                <Bi
                  cn={
                    artifacts.length === 0
                      ? "还没有资料"
                      : "此筛选下没有项目"
                  }
                  en={
                    artifacts.length === 0
                      ? "No artifacts yet"
                      : "Nothing under this filter"
                  }
                  glossSize={0.78}
                />
              </p>
              {artifacts.length === 0 && (
                <p className="mt-1 text-xs text-ink-4">
                  Add docs, links, decisions here so the AI can do cross-task discovery · AI 跨任务发现的素材源
                </p>
              )}
            </div>
          ) : (
            <ul>
              {visible.map((a) => {
                const t = typeLabel(a.type);
                const shown = a.tags.slice(0, 4);
                const more = a.tags.length - shown.length;
                return (
                  <li key={a.id} className="border-t border-rule">
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      className="group flex w-full items-start gap-3 bg-paper px-4 py-4 text-left transition hover:bg-paper-2"
                    >
                      <Glyph
                        name="diamond"
                        size={9}
                        color="var(--clay)"
                        style={{ marginTop: 8 }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <h3 className="truncate font-sc text-[15px] font-medium text-ink">
                            {a.title}
                          </h3>
                          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                            <Bi cn={t.cn} en={t.en} glossSize={0.85} />
                          </span>
                        </div>
                        {a.tasks?.title && (
                          <p className="mt-1 text-xs text-ink-3">
                            <Glyph name="arrow" size={10} /> {a.tasks.title}
                          </p>
                        )}
                        {a.content && (
                          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-ink-2">
                            {a.content}
                          </p>
                        )}
                        {shown.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {shown.map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-flex items-center gap-1 border border-rule bg-paper-2 px-1.5 py-0.5 text-[11px] text-ink-2"
                              >
                                <span className="font-mono text-[9px] uppercase text-ink-3">
                                  {tag.kind.slice(0, 3)}
                                </span>
                                <span className="font-sc">{tag.name}</span>
                              </span>
                            ))}
                            {more > 0 && (
                              <span className="font-mono text-[10px] text-ink-3">
                                +{more}
                              </span>
                            )}
                          </div>
                        )}
                        {a.storage_url && (
                          <p className="mt-2 font-mono text-[11px] text-ink-3">
                            📎 {a.storage_url}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <aside>
        <div className="mb-3">
          <Micro>
            <Bi cn="新增资料" en="Add artifact" glossSize={0.78} />
          </Micro>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 border border-rule bg-paper p-4">
          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="关联任务" en="Linked task (optional)" glossSize={0.78} />
            </Micro>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            >
              <option value="">— Unlinked / 未关联 —</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="类型" en="Type" glossSize={0.78} />
            </Micro>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ArtifactType)}
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
              <Bi cn="标题" en="Title" glossSize={0.78} />
            </Micro>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 美国仓库 Net 30 协议 · US warehouse Net 30 agreement"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="内容" en="Content · Markdown supported" glossSize={0.78} />
            </Micro>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Markdown 可用 · # heading, **bold**, - lists, [link](url)"
              rows={4}
              className="w-full border border-rule bg-paper px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none transition focus:border-ink"
            />
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="附件" en="Attachment (optional)" glossSize={0.78} />
            </Micro>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-xs text-ink-3 file:mr-3 file:border file:border-rule file:bg-paper file:px-3 file:py-1.5 file:text-xs file:text-ink-2 hover:file:bg-paper-3"
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
          >
            {submitting ? (
              <Bi cn="保存中…" en="Saving…" glossSize={0.78} />
            ) : (
              <Bi cn="保存" en="Save artifact" glossSize={0.78} />
            )}
          </button>
          {error && (
            <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
              {error}
            </p>
          )}
        </form>
      </aside>

      {editing && (
        <ArtifactDetailModal
          artifact={editing}
          tasks={tasks}
          allProjectTags={allTags}
          projectId={projectId}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setArtifacts((prev) =>
              prev.map((x) => (x.id === updated.id ? updated : x)),
            );
            router.refresh();
          }}
          onDeleted={(id) => {
            setArtifacts((prev) => prev.filter((x) => x.id !== id));
            setEditing(null);
            router.refresh();
          }}
          onTagsRefresh={async (artifactId) => {
            const tags = await refreshArtifactTags(artifactId);
            await refreshAllTags();
            return tags;
          }}
        />
      )}
    </div>
  );
}

// ── Detail / edit modal ────────────────────────────────────────────

type Mode = "view" | "edit";

function ArtifactDetailModal({
  artifact: initial,
  tasks,
  allProjectTags,
  projectId,
  onClose,
  onSaved,
  onDeleted,
  onTagsRefresh,
}: {
  artifact: Artifact;
  tasks: { id: string; title: string }[];
  allProjectTags: TagRow[];
  projectId: string;
  onClose: () => void;
  onSaved: (a: Artifact) => void;
  onDeleted: (id: string) => void;
  onTagsRefresh: (artifactId: string) => Promise<TagRow[]>;
}) {
  // Local snapshot — updated on save so we can stay open in view mode
  // showing the latest content. The list in the parent is also updated
  // via onSaved.
  const [current, setCurrent] = useState<Artifact>(initial);
  const [mode, setMode] = useState<Mode>("view");

  // Edit-mode buffers — only commit to `current` on Save
  const [title, setTitle] = useState(initial.title);
  const [type, setType] = useState<ArtifactType>(initial.type as ArtifactType);
  const [taskId, setTaskId] = useState<string>(initial.task_id ?? "");
  const [content, setContent] = useState(initial.content ?? "");

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function enterEdit() {
    setTitle(current.title);
    setType(current.type as ArtifactType);
    setTaskId(current.task_id ?? "");
    setContent(current.content ?? "");
    setError(null);
    setMode("edit");
  }

  function cancelEdit() {
    // Discard buffer changes; return to view of current
    setError(null);
    setMode("view");
  }

  async function ensureSignedUrl() {
    if (!current.storage_url || signedUrl) return;
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.storage
      .from("artifacts")
      .createSignedUrl(current.storage_url, 60 * 10);
    if (error) {
      setError(`Download link failed: ${error.message}`);
      return;
    }
    setSignedUrl(data.signedUrl);
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("artifacts")
        .update({
          title: title.trim(),
          type,
          task_id: taskId || null,
          content: content.trim() || null,
        })
        .eq("id", current.id)
        .select(
          "id, task_id, project_id, type, title, content, storage_url, created_at, tasks(id, title)",
        )
        .single();
      if (error) throw error;
      const updated: Artifact = {
        ...(data as Omit<Artifact, "tags">),
        tags: current.tags,
      };
      setCurrent(updated);
      onSaved(updated);
      setMode("view");
    } catch (err) {
      console.error("Artifact save failed:", err);
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    setDeleting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      if (current.storage_url) {
        await supabase.storage.from("artifacts").remove([current.storage_url]);
      }
      const { error } = await supabase.from("artifacts").delete().eq("id", current.id);
      if (error) throw error;
      onDeleted(current.id);
    } catch (err) {
      console.error("Artifact delete failed:", err);
      setError(extractError(err));
    } finally {
      setDeleting(false);
    }
  }

  const t = typeLabel(current.type);
  const isViewing = mode === "view";

  return (
    <div className="almanac fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col border border-rule-ink bg-paper">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
          <div className="min-w-0 flex-1">
            <Micro style={{ marginBottom: 4 }}>
              <Bi cn={t.cn} en={t.en} glossSize={0.85} />
              {isViewing ? null : (
                <span className="ml-2 text-clay-ink">· 编辑中 / Editing</span>
              )}
            </Micro>
            {isViewing ? (
              <h2 className="font-sc text-xl font-medium leading-tight text-ink">
                {current.title}
              </h2>
            ) : (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-rule bg-paper px-2 py-1 font-sc text-xl font-medium text-ink outline-none focus:border-ink"
              />
            )}
            {current.tasks?.title && (
              <p className="mt-1 text-xs text-ink-3">
                <Glyph name="arrow" size={10} /> {current.tasks.title}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {isViewing && (
              <button
                type="button"
                onClick={enterEdit}
                className="inline-flex items-center gap-1.5 border border-rule bg-paper px-3 py-1.5 text-sm text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
              >
                <Glyph name="pencil" size={11} />
                <Bi cn="编辑" en="Edit" glossSize={0.78} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="text-ink-3 transition hover:text-ink"
            >
              <Glyph name="cross" size={16} />
            </button>
          </div>
        </header>

        {error && (
          <div className="border-b border-rust-soft bg-rust-soft/40 px-6 py-3 text-sm text-rust-ink">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isViewing ? (
            <ViewBody
              artifact={current}
              signedUrl={signedUrl}
              ensureSignedUrl={ensureSignedUrl}
            />
          ) : (
            <EditBody
              type={type}
              setType={setType}
              taskId={taskId}
              setTaskId={setTaskId}
              tasks={tasks}
              content={content}
              setContent={setContent}
              storage_url={current.storage_url}
            />
          )}

          {/* Tags — view mode shows read-only chips; edit mode shows full editor */}
          <div className="mt-6 border-t border-rule pt-4">
            {isViewing ? (
              <ViewTags tags={current.tags} />
            ) : (
              <TagEditor
                artifactId={current.id}
                projectId={projectId}
                initialTags={current.tags}
                allProjectTags={allProjectTags}
                onChange={async () => {
                  const refreshed = await onTagsRefresh(current.id);
                  setCurrent((c) => ({ ...c, tags: refreshed }));
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-rule px-6 py-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-rust-ink">
                <Bi cn="确认删除？" en="Delete this artifact?" glossSize={0.78} />
              </span>
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="bg-rust px-3 py-1 text-xs font-medium text-paper transition hover:bg-rust-ink disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="border border-rust-soft bg-paper px-3 py-1 text-xs text-rust-ink transition hover:bg-rust-soft/50"
            >
              <Bi cn="删除" en="Delete" glossSize={0.78} />
            </button>
          )}

          <div className="flex items-center gap-3 text-xs text-ink-4">
            <span className="font-mono">
              {new Date(current.created_at).toLocaleString()}
            </span>
            {isViewing ? (
              <button
                type="button"
                onClick={onClose}
                className="border border-rule bg-paper px-4 py-2 text-sm text-ink-2 transition hover:bg-paper-3 hover:text-ink"
              >
                <Bi cn="关闭" en="Close" glossSize={0.78} />
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="border border-rule bg-paper px-4 py-2 text-sm text-ink-2 transition hover:bg-paper-3 hover:text-ink"
                >
                  <Bi cn="取消" en="Cancel" glossSize={0.78} />
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving || !title.trim()}
                  className="bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
                >
                  {saving ? (
                    <Bi cn="保存中…" en="Saving…" glossSize={0.78} />
                  ) : (
                    <Bi cn="保存" en="Save" glossSize={0.78} />
                  )}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── View body ──────────────────────────────────────────────────────

function ViewBody({
  artifact,
  signedUrl,
  ensureSignedUrl,
}: {
  artifact: Artifact;
  signedUrl: string | null;
  ensureSignedUrl: () => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      {artifact.content ? (
        <MarkdownView source={artifact.content} />
      ) : (
        <p className="text-sm italic text-ink-3">
          <Bi cn="（无内容）" en="(No content)" glossSize={0.85} />
        </p>
      )}

      {artifact.storage_url && (
        <div className="border border-rule bg-paper-2 p-3">
          <Micro style={{ marginBottom: 4 }}>
            <Bi cn="附件" en="Attached file" glossSize={0.78} />
          </Micro>
          <p className="break-all font-mono text-xs text-ink-2">
            {artifact.storage_url}
          </p>
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm text-clay-ink underline decoration-rule underline-offset-2 hover:decoration-clay-ink"
            >
              <Bi cn="打开文件" en="Open file" glossSize={0.78} /> ↗
            </a>
          ) : (
            <button
              type="button"
              onClick={ensureSignedUrl}
              className="mt-2 text-sm text-clay-ink underline decoration-rule underline-offset-2 hover:decoration-clay-ink"
            >
              <Bi cn="生成下载链接" en="Generate download link" glossSize={0.78} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ViewTags({ tags }: { tags: TagRow[] }) {
  return (
    <div>
      <Micro style={{ marginBottom: 6 }}>
        <Bi cn="标签" en="Tags" glossSize={0.78} />
      </Micro>
      {tags.length === 0 ? (
        <p className="text-xs italic text-ink-3">
          <Bi cn="（无标签）" en="(No tags)" glossSize={0.85} />
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1.5 border border-rule bg-paper-2 px-2 py-0.5 text-xs text-ink-2"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">
                {t.kind.slice(0, 3)}
              </span>
              <span className="font-sc">{t.name}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Edit body ──────────────────────────────────────────────────────

function EditBody({
  type,
  setType,
  taskId,
  setTaskId,
  tasks,
  content,
  setContent,
  storage_url,
}: {
  type: ArtifactType;
  setType: (t: ArtifactType) => void;
  taskId: string;
  setTaskId: (id: string) => void;
  tasks: { id: string; title: string }[];
  content: string;
  setContent: (c: string) => void;
  storage_url: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="类型" en="Type" glossSize={0.78} />
          </Micro>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ArtifactType)}
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
            <Bi cn="关联任务" en="Linked task" glossSize={0.78} />
          </Micro>
          <select
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
          >
            <option value="">— Unlinked / 未关联 —</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <Micro style={{ marginBottom: 6 }}>
          <Bi cn="内容" en="Content · Markdown supported" glossSize={0.78} />
        </Micro>
        <textarea
          rows={14}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="w-full border border-rule bg-paper px-3 py-2 font-mono text-xs leading-relaxed text-ink outline-none transition focus:border-ink"
        />
      </label>

      {storage_url && (
        <div className="border border-rule bg-paper-2 p-3">
          <Micro style={{ marginBottom: 4 }}>
            <Bi cn="附件路径" en="Attached file path (read-only)" glossSize={0.78} />
          </Micro>
          <p className="break-all font-mono text-xs text-ink-2">{storage_url}</p>
        </div>
      )}
    </div>
  );
}
