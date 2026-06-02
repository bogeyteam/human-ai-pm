"use client";

/**
 * Tasks Kanban — Almanac 4-column + backlog-rail layout.
 *
 * Status enum is unchanged (backlog/ready/in_progress/blocked/done/dropped).
 * The 4 active columns (Ready · In progress · Blocked · Done) sit at the top.
 * `backlog` lives in a collapsed bottom rail; `dropped` is hidden behind a
 * "Show dropped" toolbar toggle (off by default).
 *
 * Desktop (>=1024px): 4 columns side-by-side, backlog rail below.
 * Mobile  (<1024px):  one column at a time + horizontal tab bar to switch.
 *
 * dnd-kit handles drag-and-drop across all surfaces — column → column,
 * column → backlog, backlog → column. TaskDetailModal is preserved as-is.
 */

import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Bi, Glyph, Micro } from "@/components/almanac";
import { BrainstormToTasks } from "@/components/BrainstormToTasks";
import { discoverFindings } from "@/lib/api";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

import { BacklogRail } from "./backlog-rail";

type TaskStatus = "backlog" | "ready" | "in_progress" | "blocked" | "done" | "dropped";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  estimated_hours: number | null;
  actual_hours: number | null;
  owner_id: string | null;
  created_by: string;
  created_at: string;
};

// Supabase v2.50 generics reject `Record<string, unknown>` against `TablesUpdate`
// (treats unknown values as `never`). Narrow to the actual columns we write.
type TaskUpdatePatch = {
  status?: string;
  completed_at?: string | null;
  title?: string;
  description?: string | null;
  priority?: number;
  owner_id?: string | null;
  estimated_hours?: number | null;
  actual_hours?: number | null;
};

type Teammate = { id: string; name: string | null; email: string };

type ColumnDef = {
  status: TaskStatus;
  cn: string;
  en: string;
  tone: string;
};

// Active columns (top grid). Backlog and Dropped are handled separately.
const ACTIVE_COLUMNS: ColumnDef[] = [
  { status: "ready", cn: "就绪", en: "Ready", tone: "bg-paper-2" },
  { status: "in_progress", cn: "进行中", en: "In progress", tone: "bg-ochre-soft" },
  { status: "blocked", cn: "阻塞中", en: "Blocked", tone: "bg-rust-soft" },
  { status: "done", cn: "完成", en: "Done", tone: "bg-sage-soft" },
];

const DROPPED_COLUMN: ColumnDef = {
  status: "dropped",
  cn: "已搁置",
  en: "Dropped",
  tone: "bg-paper-3",
};

// All statuses surfaced in the modal's status select.
const ALL_STATUSES: ColumnDef[] = [
  { status: "backlog", cn: "待办", en: "Backlog", tone: "bg-paper-2" },
  ...ACTIVE_COLUMNS,
  DROPPED_COLUMN,
];

export function TasksKanban({
  projectId,
  initialTasks,
  teammates,
}: {
  projectId: string;
  initialTasks: Task[];
  teammates: Teammate[];
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Layout state
  const [showDropped, setShowDropped] = useState(false);
  const [backlogExpanded, setBacklogExpanded] = useState(false);
  // Mobile: which active column is on screen.
  const [activeMobileTab, setActiveMobileTab] = useState<TaskStatus>("ready");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const [editingTask, setEditingTask] = useState<Task | null>(null);

  function applyEdit(updated: Task) {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  function applyDelete(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    const taskId = String(active.id);
    const newStatus = String(over.id) as TaskStatus;
    const existing = tasks.find((t) => t.id === taskId);
    if (!existing || existing.status === newStatus) return;

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
    );

    const supabase = supabaseBrowser();
    const patch: TaskUpdatePatch = { status: newStatus };
    if (newStatus === "done") patch.completed_at = new Date().toISOString();
    const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
    if (error) {
      setError(error.message);
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, status: existing.status } : t)),
      );
    } else {
      // Fire-and-forget cross-task discovery on task completion (M6).
      if (newStatus === "done") {
        void discoverFindings(projectId).catch(() => {
          // Surfacing this would be noisy; the user can re-run from the
          // Findings tab if they suspect a missed scan.
        });
      }
      router.refresh();
    }
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          title: newTitle.trim(),
          status: "backlog",
          created_by: "human",
        })
        .select(
          "id, title, description, status, priority, estimated_hours, owner_id, created_by, created_at",
        )
        .single();
      if (error) throw error;
      setTasks((prev) => [data as Task, ...prev]);
      setNewTitle("");
      // Auto-expand backlog so the user sees where the new task landed.
      setBacklogExpanded(true);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  }

  // Bucket tasks by status once.
  const visibleColumns: ColumnDef[] = showDropped
    ? [...ACTIVE_COLUMNS, DROPPED_COLUMN]
    : ACTIVE_COLUMNS;

  const columnsWithItems = visibleColumns.map((col) => ({
    ...col,
    items: tasks.filter((t) => t.status === col.status),
  }));

  const backlogItems = tasks.filter((t) => t.status === "backlog");

  // Mobile-tab options include backlog (so users can reach it on small screens).
  const mobileTabs: ColumnDef[] = [
    ...ACTIVE_COLUMNS,
    { status: "backlog", cn: "待办", en: "Backlog", tone: "bg-paper-2" },
    ...(showDropped ? [DROPPED_COLUMN] : []),
  ];

  const activeMobileColumn =
    activeMobileTab === "backlog"
      ? { status: "backlog" as TaskStatus, cn: "待办", en: "Backlog", tone: "bg-paper-2", items: backlogItems }
      : columnsWithItems.find((c) => c.status === activeMobileTab) ?? columnsWithItems[0];

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BrainstormToTasks projectId={projectId} />
        <label className="flex cursor-pointer select-none items-center gap-2 text-[12.5px] text-ink-2">
          <input
            type="checkbox"
            checked={showDropped}
            onChange={(e) => setShowDropped(e.target.checked)}
            className="h-3.5 w-3.5 cursor-pointer accent-ink"
          />
          <Bi cn="显示已搁置" en="Show dropped" glossSize={0.78} />
        </label>
      </div>

      <form onSubmit={createTask} className="flex gap-2">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="快速添加 · type to add a task → lands in backlog"
          className="flex-1 rounded border border-rule px-3 py-2 text-sm font-sc outline-none focus:border-rule-ink"
        />
        <button
          type="submit"
          disabled={creating || !newTitle.trim()}
          className="rounded bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-clay-deep disabled:opacity-50"
        >
          <Bi cn="加入待办" en="Add" glossSize={0.74} />
        </button>
      </form>
      {error && <p className="text-sm text-rust">{error}</p>}

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {/* Mobile tab bar — visible only below lg. */}
        <div className="lg:hidden">
          <div className="-mx-2 flex gap-1 overflow-x-auto px-2 pb-2">
            {mobileTabs.map((tab) => {
              const count =
                tab.status === "backlog"
                  ? backlogItems.length
                  : tasks.filter((t) => t.status === tab.status).length;
              const isActive = tab.status === activeMobileTab;
              return (
                <button
                  key={tab.status}
                  type="button"
                  onClick={() => setActiveMobileTab(tab.status)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-3 py-1.5 text-[12px] ${
                    isActive
                      ? "border-ink bg-ink text-paper"
                      : "border-rule bg-paper text-ink-2 hover:bg-paper-2"
                  }`}
                >
                  <Bi cn={tab.cn} en={tab.en} glossSize={0.74} />
                  <span className="font-mono text-[10px] opacity-80">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Single visible column on mobile. */}
          <Column
            status={activeMobileColumn.status}
            cn={activeMobileColumn.cn}
            en={activeMobileColumn.en}
            tone={activeMobileColumn.tone}
            count={activeMobileColumn.items.length}
          >
            {activeMobileColumn.items.map((t) => (
              <DraggableCard
                key={t.id}
                task={t}
                teammates={teammates}
                onOpen={() => setEditingTask(t)}
              />
            ))}
          </Column>
        </div>

        {/* Desktop 4-column grid (or 5 when dropped is shown). */}
        <div className="hidden lg:block">
          <div
            className={`grid gap-3 ${
              showDropped ? "grid-cols-5" : "grid-cols-4"
            }`}
          >
            {columnsWithItems.map((col) => (
              <Column
                key={col.status}
                status={col.status}
                cn={col.cn}
                en={col.en}
                tone={col.tone}
                count={col.items.length}
              >
                {col.items.map((t) => (
                  <DraggableCard
                    key={t.id}
                    task={t}
                    teammates={teammates}
                    onOpen={() => setEditingTask(t)}
                  />
                ))}
              </Column>
            ))}
          </div>

          {/* Backlog rail — desktop only; mobile reaches backlog via the tab. */}
          <BacklogRail
            items={backlogItems}
            teammates={teammates}
            expanded={backlogExpanded}
            onToggle={() => setBacklogExpanded((v) => !v)}
            onOpen={(t) => setEditingTask(t)}
          />
        </div>
      </DndContext>

      {editingTask && (
        <TaskDetailModal
          task={editingTask}
          teammates={teammates}
          projectId={projectId}
          onClose={() => setEditingTask(null)}
          onSaved={(updated) => {
            applyEdit(updated);
            setEditingTask(null);
            router.refresh();
          }}
          onDeleted={(id) => {
            applyDelete(id);
            setEditingTask(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Column({
  status,
  cn,
  en,
  tone,
  count,
  children,
}: {
  status: TaskStatus;
  cn: string;
  en: string;
  tone: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[320px] flex-col rounded-md border ${
        isOver ? "border-rule-ink" : "border-rule"
      } ${tone} p-2`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[12.5px] font-medium text-ink">
          <Bi cn={cn} en={en} glossSize={0.78} />
        </span>
        <span
          data-tabular
          className="font-mono text-[11px] text-ink-3"
          aria-label={`${count} tasks`}
        >
          {count}
        </span>
      </div>
      <div className="flex-1 space-y-2">{children}</div>
    </div>
  );
}

function DraggableCard({
  task,
  teammates,
  onOpen,
}: {
  task: Task;
  teammates: Teammate[];
  onOpen: () => void;
}) {
  const owner = teammates.find((t) => t.id === task.owner_id);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const aiAuthored = task.created_by === "ai";
  const isDone = task.status === "done";

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...(aiAuthored ? { borderLeft: "2px solid var(--ai-rule, #8b8bff)" } : {}),
      }}
      className={`group relative rounded border border-rule bg-paper p-3 text-sm shadow-sm transition hover:border-rule-ink ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {/* Edit button — must be outside the drag listeners so its click isn't
          consumed by dnd-kit's pointer handlers. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-1 top-1 rounded p-1 text-xs text-ink-4 opacity-0 transition hover:bg-paper-3 hover:text-ink group-hover:opacity-100"
        aria-label="Edit task"
      >
        ✎
      </button>

      {/* Drag handle — the rest of the card */}
      <div
        {...listeners}
        {...attributes}
        className="cursor-grab pr-5 active:cursor-grabbing"
      >
        <p
          className={`font-medium ${
            aiAuthored ? "font-serif italic" : ""
          } ${isDone ? "text-ink-3 line-through decoration-ink-4" : "text-ink"}`}
        >
          {task.title}
        </p>
        {task.description && (
          <p className="mt-1 line-clamp-2 text-xs text-ink-2">{task.description}</p>
        )}
        <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
          <span className="font-mono">
            {aiAuthored ? "AI" : "human"}
            {task.estimated_hours ? ` · ${task.estimated_hours}h` : ""}
          </span>
          {owner ? (
            <span>{owner.name || owner.email}</span>
          ) : (
            <span className="italic">unassigned</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Detail / edit modal ────────────────────────────────────────────

function TaskDetailModal({
  task,
  teammates,
  projectId,
  onClose,
  onSaved,
  onDeleted,
}: {
  task: Task;
  teammates: Teammate[];
  projectId: string;
  onClose: () => void;
  onSaved: (t: Task) => void;
  onDeleted: (id: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status as TaskStatus);
  const [priority, setPriority] = useState<string>(String(task.priority));
  const [ownerId, setOwnerId] = useState<string>(task.owner_id ?? "");
  const [estimatedHours, setEstimatedHours] = useState<string>(
    task.estimated_hours != null ? String(task.estimated_hours) : "",
  );
  const [actualHours, setActualHours] = useState<string>(
    task.actual_hours != null ? String(task.actual_hours) : "",
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const patch: TaskUpdatePatch = {
        title: title.trim(),
        description: description.trim() || null,
        status,
        priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
        owner_id: ownerId || null,
        estimated_hours: estimatedHours === "" ? null : Number(estimatedHours),
        actual_hours: actualHours === "" ? null : Number(actualHours),
      };
      if (status === "done" && task.status !== "done") {
        patch.completed_at = new Date().toISOString();
      }
      const { data, error } = await supabase
        .from("tasks")
        .update(patch)
        .eq("id", task.id)
        .select(
          "id, title, description, status, priority, estimated_hours, actual_hours, owner_id, created_by, created_at",
        )
        .single();
      if (error) throw error;
      onSaved({ ...(data as Task), description: data?.description ?? null });
    } catch (err) {
      console.error("Task save failed:", err);
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
      const { error } = await supabase.from("tasks").delete().eq("id", task.id);
      if (error) throw error;
      onDeleted(task.id);
    } catch (err) {
      console.error("Task delete failed:", err);
      setError(extractError(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="almanac fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-rule-ink bg-paper">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
          <div className="min-w-0 flex-1">
            <Micro style={{ marginBottom: 4 }}>
              <Bi cn="任务" en="Task" glossSize={0.85} />
              <span className="ml-2 text-clay-ink">· 编辑中 / Editing</span>
            </Micro>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-rule bg-paper px-2 py-1 font-sc text-xl font-medium text-ink outline-none focus:border-ink"
            />
            <p className="mt-1 text-xs text-ink-3">
              <span className="font-mono">
                {task.created_by === "ai" ? "AI" : "human"}
              </span>{" "}
              · created {new Date(task.created_at).toLocaleString()}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          <div className="space-y-4">
            <label className="block">
              <Micro style={{ marginBottom: 6 }}>
                <Bi cn="描述" en="Description" glossSize={0.78} />
              </Micro>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <Micro style={{ marginBottom: 6 }}>
                  <Bi cn="状态" en="Status" glossSize={0.78} />
                </Micro>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as TaskStatus)}
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                >
                  {ALL_STATUSES.map((c) => (
                    <option key={c.status} value={c.status}>
                      {c.cn} / {c.en}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <Micro style={{ marginBottom: 6 }}>
                  <Bi cn="负责人" en="Owner" glossSize={0.78} />
                </Micro>
                <select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
                >
                  <option value="">— Unassigned —</option>
                  {teammates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name || t.email}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <label className="block">
                <Micro style={{ marginBottom: 6 }}>
                  <Bi cn="优先级" en="Priority" glossSize={0.78} />
                </Micro>
                <input
                  type="number"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full border border-rule bg-paper px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-ink"
                />
              </label>
              <label className="block">
                <Micro style={{ marginBottom: 6 }}>
                  <Bi cn="预估工时" en="Est hours" glossSize={0.78} />
                </Micro>
                <input
                  type="number"
                  step="0.5"
                  value={estimatedHours}
                  onChange={(e) => setEstimatedHours(e.target.value)}
                  className="w-full border border-rule bg-paper px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-ink"
                />
              </label>
              <label className="block">
                <Micro style={{ marginBottom: 6 }}>
                  <Bi cn="实际工时" en="Actual hours" glossSize={0.78} />
                </Micro>
                <input
                  type="number"
                  step="0.5"
                  value={actualHours}
                  onChange={(e) => setActualHours(e.target.value)}
                  className="w-full border border-rule bg-paper px-3 py-2 font-mono text-sm text-ink outline-none transition focus:border-ink"
                />
              </label>
            </div>

            <TaskNotes taskId={task.id} projectId={projectId} teammates={teammates} />
          </div>
        </div>

        {/* Footer */}
        <footer className="flex items-center justify-between gap-2 border-t border-rule px-6 py-4">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-rust-ink">
                <Bi cn="确认删除？" en="Delete this task?" glossSize={0.78} />
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
            <button
              type="button"
              onClick={onClose}
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
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Task notes (chronological log, uses `messages` table) ──────────

type Note = {
  id: string;
  content: string;
  created_at: string;
  sender_id: string | null;
};

function TaskNotes({
  taskId,
  projectId,
  teammates,
}: {
  taskId: string;
  projectId: string;
  teammates: Teammate[];
}) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch on mount + when taskId changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("messages")
        .select("id, content, created_at, sender_id")
        .eq("task_id", taskId)
        .eq("channel", "in_app")
        .order("created_at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setNotes([]);
      } else {
        setNotes((data ?? []) as Note[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("messages")
        .insert({
          project_id: projectId,
          task_id: taskId,
          sender_type: "user",
          sender_id: user?.id ?? null,
          content: draft.trim(),
          channel: "in_app",
        })
        .select("id, content, created_at, sender_id")
        .single();
      if (error) throw error;
      setNotes((prev) => [data as Note, ...(prev ?? [])]);
      setDraft("");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function authorLabel(senderId: string | null): string {
    if (!senderId) return "—";
    const t = teammates.find((x) => x.id === senderId);
    return t?.name || t?.email || "someone";
  }

  return (
    <div className="mt-2 border-t border-rule pt-4">
      <Micro style={{ marginBottom: 8 }}>
        <Bi cn="备注" en="Notes" glossSize={0.78} />
      </Micro>

      <form onSubmit={onAdd} className="mb-3 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="留个备注 · leave a note (e.g. called supplier, sample arrives Mon)"
          className="flex-1 border border-rule bg-paper px-2 py-1 text-sm text-ink outline-none transition focus:border-ink"
        />
        <button
          type="submit"
          disabled={submitting || !draft.trim()}
          className="bg-ink px-3 py-1 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
        >
          <Bi cn="添加" en="Add" glossSize={0.78} />
        </button>
      </form>

      {error && (
        <p className="mb-2 border border-rust-soft bg-rust-soft/40 px-2 py-1 text-xs text-rust-ink">
          {error}
        </p>
      )}

      {notes === null ? (
        <p className="text-xs italic text-ink-4">
          <Bi cn="加载中…" en="Loading…" glossSize={0.78} />
        </p>
      ) : notes.length === 0 ? (
        <p className="text-xs italic text-ink-3">
          <Bi cn="暂无备注" en="No notes yet" glossSize={0.78} />
        </p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="border border-rule bg-paper-2 px-3 py-2 text-sm"
            >
              <p className="whitespace-pre-wrap text-ink">{n.content}</p>
              <p className="mt-1 flex items-center justify-between font-mono text-[11px] text-ink-3">
                <span>{authorLabel(n.sender_id)}</span>
                <span>{new Date(n.created_at).toLocaleString()}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
