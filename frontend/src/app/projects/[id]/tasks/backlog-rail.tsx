"use client";

/**
 * BacklogRail — collapsed-by-default horizontal strip of backlog tasks at the
 * bottom of the Kanban. Expands into a scrollable horizontal row of small
 * task chips. Designed to keep low-priority work visible-but-not-loud while
 * the 4 active columns above stay readable on laptops.
 *
 * Per the Almanac design (surfaces-desktop.jsx → TasksBoard), the rail is a
 * single ruled bar with a chevron toggle. Backlog tasks themselves remain
 * full citizens of the dnd-kit graph — drag from rail → column moves the
 * task into that status; drag from column → rail sets it back to "backlog".
 */

import { useDraggable, useDroppable } from "@dnd-kit/core";

import { Bi } from "@/components/almanac";

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

type Teammate = { id: string; name: string | null; email: string };

export function BacklogRail({
  items,
  teammates,
  expanded,
  onToggle,
  onOpen,
}: {
  items: Task[];
  teammates: Teammate[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "backlog" });

  return (
    <div
      ref={setNodeRef}
      className={`mt-3 rounded-md border ${
        isOver ? "border-rule-ink" : "border-rule"
      } bg-paper-2`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-paper-3"
        aria-expanded={expanded}
        aria-controls="backlog-rail-body"
      >
        <span className="flex items-center gap-2.5 text-[12.5px] text-ink-2">
          <span
            aria-hidden
            className={`inline-block transform transition-transform ${
              expanded ? "rotate-180" : "rotate-0"
            }`}
          >
            ▾
          </span>
          <Bi cn="待办" en="Backlog" glossSize={0.78} />
          <span data-tabular className="font-mono text-[11px] text-ink-3">
            {items.length}
          </span>
        </span>

        {!expanded && items.length > 0 && (
          <span className="hidden truncate pl-4 text-[11.5px] text-ink-3 md:block">
            {items
              .slice(0, 3)
              .map((t) => t.title)
              .join("  ·  ")}
            {items.length > 3 ? `  ·  +${items.length - 3} more` : ""}
          </span>
        )}
        {!expanded && items.length === 0 && (
          <span className="text-[11.5px] italic text-ink-4">
            <Bi cn="（暂无）" en="empty" glossSize={0.78} />
          </span>
        )}
      </button>

      {expanded && (
        <div
          id="backlog-rail-body"
          className="border-t border-rule px-3 py-3"
        >
          {items.length === 0 ? (
            <p className="px-2 py-4 text-center text-[12px] italic text-ink-4">
              <Bi cn="积压列表为空" en="No backlog items" glossSize={0.78} />
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {items.map((t) => (
                <BacklogChip
                  key={t.id}
                  task={t}
                  teammates={teammates}
                  onOpen={() => onOpen(t)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BacklogChip({
  task,
  teammates,
  onOpen,
}: {
  task: Task;
  teammates: Teammate[];
  onOpen: () => void;
}) {
  const owner = teammates.find((tm) => tm.id === task.owner_id);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  const aiAuthored = task.created_by === "ai";

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        ...(aiAuthored ? { borderLeft: "2px solid var(--ai-rule, #8b8bff)" } : {}),
      }}
      className={`group relative flex min-w-[180px] max-w-[240px] shrink-0 flex-col gap-1 rounded border border-rule bg-paper p-2 text-[12px] shadow-sm transition hover:border-rule-ink ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-0.5 top-0.5 rounded p-1 text-[10px] text-ink-4 opacity-0 transition hover:bg-paper-3 hover:text-ink group-hover:opacity-100"
        aria-label="Edit task"
      >
        ✎
      </button>

      <div
        {...listeners}
        {...attributes}
        className="cursor-grab pr-4 active:cursor-grabbing"
      >
        <p
          className={`line-clamp-2 font-medium text-ink ${
            aiAuthored ? "font-serif italic" : ""
          }`}
        >
          {task.title}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10.5px] text-ink-3">
          <span className="font-mono">
            {aiAuthored ? "AI" : "human"}
            {task.estimated_hours ? ` · ${task.estimated_hours}h` : ""}
          </span>
          {owner ? (
            <span className="truncate">{owner.name || owner.email}</span>
          ) : (
            <span className="italic text-ink-4">—</span>
          )}
        </div>
      </div>
    </div>
  );
}
