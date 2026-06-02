"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  runOptimizer,
  submitOptimizerDecisions,
  type OptimizerAddItem,
  type OptimizerDecision,
  type OptimizerDropItem,
  type OptimizerReorderItem,
  type OptimizerReview,
  type OptimizerRiskItem,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";

const REJECT_CHIPS = [
  { key: "still_needed", label: "还需要做 / Still needed" },
  { key: "priority_misread", label: "优先级判断错了 / Priority misread" },
  { key: "already_in_progress", label: "已经在做 / Already in progress" },
  { key: "wrong_timing", label: "时机不对 / Wrong timing" },
  { key: "other", label: "其他 / Other" },
];

export type LatestReview = {
  manager_action_id: string;
  created_at: string;
  accepted_by_human: boolean | null;
  human_feedback: string | null;
  review: Record<string, unknown> | null;
};

type ItemState = {
  action: "accept" | "edit" | "reject";
  edit: Record<string, unknown> | null;
  reject_chip: string | null;
  reject_free: string;
};

type DecisionMap = {
  reorder: Record<number, ItemState>;
  drops: Record<number, ItemState>;
  adds: Record<number, ItemState>;
};

function emptyDecisions(): DecisionMap {
  return { reorder: {}, drops: {}, adds: {} };
}

function coerceReview(raw: Record<string, unknown> | null): OptimizerReview | null {
  if (!raw) return null;
  return {
    risks: (raw.risks as OptimizerRiskItem[]) ?? [],
    reorder: (raw.reorder as OptimizerReorderItem[]) ?? [],
    drops: (raw.drops as OptimizerDropItem[]) ?? [],
    adds: (raw.adds as OptimizerAddItem[]) ?? [],
    critical_path: (raw.critical_path as string[]) ?? [],
    unknowns: (raw.unknowns as string[]) ?? [],
    overall_reasoning: (raw.overall_reasoning as string) ?? null,
  };
}

export function OptimizerPanel({
  projectId,
  initialReview,
  taskTitles,
}: {
  projectId: string;
  initialReview: LatestReview | null;
  taskTitles: Record<string, string>;
}) {
  const router = useRouter();

  const [actionId, setActionId] = useState<string | null>(
    initialReview?.manager_action_id ?? null,
  );
  const [review, setReview] = useState<OptimizerReview | null>(
    coerceReview(initialReview?.review ?? null),
  );
  const [reviewedAt, setReviewedAt] = useState<string | null>(
    initialReview?.created_at ?? null,
  );
  const [decisions, setDecisions] = useState<DecisionMap>(emptyDecisions);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reflection, setReflection] = useState<string | null>(null);

  const alreadyFinalized = initialReview?.accepted_by_human !== null && initialReview !== null;

  const summary = useMemo(() => {
    const all = [
      ...Object.values(decisions.reorder),
      ...Object.values(decisions.drops),
      ...Object.values(decisions.adds),
    ];
    return {
      accept: all.filter((s) => s.action === "accept").length,
      edit: all.filter((s) => s.action === "edit").length,
      reject: all.filter((s) => s.action === "reject").length,
    };
  }, [decisions]);

  function setItem(
    kind: keyof DecisionMap,
    index: number,
    patch: Partial<ItemState>,
  ) {
    setDecisions((prev) => {
      const current = prev[kind][index] ?? {
        action: "accept",
        edit: null,
        reject_chip: null,
        reject_free: "",
      };
      return {
        ...prev,
        [kind]: { ...prev[kind], [index]: { ...current, ...patch } },
      };
    });
  }

  function getItem(kind: keyof DecisionMap, index: number): ItemState {
    return (
      decisions[kind][index] ?? {
        action: "accept",
        edit: null,
        reject_chip: null,
        reject_free: "",
      }
    );
  }

  async function onRun() {
    setError(null);
    setReflection(null);
    setRunning(true);
    try {
      const res = await runOptimizer(projectId);
      setActionId(res.manager_action_id);
      setReview(res.review);
      setReviewedAt(new Date().toISOString());
      setDecisions(emptyDecisions());
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setRunning(false);
    }
  }

  async function onSubmit() {
    if (!actionId || !review) return;

    const payload: OptimizerDecision[] = [];
    const kinds: (keyof DecisionMap)[] = ["reorder", "drops", "adds"];
    const apiKind: Record<keyof DecisionMap, "reorder" | "drop" | "add"> = {
      reorder: "reorder",
      drops: "drop",
      adds: "add",
    };

    for (const kind of kinds) {
      const items =
        kind === "reorder"
          ? review.reorder
          : kind === "drops"
            ? review.drops
            : review.adds;
      for (let i = 0; i < items.length; i++) {
        const state = getItem(kind, i);
        if (state.action === "reject" && !state.reject_chip && !state.reject_free.trim()) {
          setError(
            `Reject without reason on ${kind}[${i}]. Pick a chip or type a reason.`,
          );
          return;
        }
        payload.push({
          kind: apiKind[kind],
          target_index: i,
          action: state.action,
          edit: state.action === "edit" ? state.edit : null,
          reject_reason_chip: state.action === "reject" ? state.reject_chip : null,
          reject_reason_free:
            state.action === "reject" ? state.reject_free.trim() || null : null,
        });
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      const res = await submitOptimizerDecisions(projectId, {
        manager_action_id: actionId,
        decisions: payload,
      });
      setReflection(
        `Applied: ${res.applied.reorders} reorders · ${res.applied.drops} drops · ${res.applied.adds} adds. ` +
          `Feedback: ${res.summary.accepted} accept · ${res.summary.edited} edit · ${res.summary.rejected} reject. ` +
          `下次再跑时 AI 会看到这些反馈 / next run will see this feedback.`,
      );
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            周度 Backlog Optimizer / Weekly review
          </h2>
          {reviewedAt && (
            <p className="text-xs text-neutral-500">
              Last run: {new Date(reviewedAt).toLocaleString()}
              {alreadyFinalized && " · already reviewed"}
            </p>
          )}
        </div>
        <button
          onClick={onRun}
          disabled={running || submitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running ? "Running…" : review ? "↻ Run optimizer now" : "✨ Run optimizer now"}
        </button>
      </header>

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}
      {reflection && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {reflection}
        </div>
      )}

      {!review ? (
        <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">
          还没跑过 — 点击 Run optimizer 让 AI 扫描整个 backlog 给出建议。<br />
          No review yet — run the optimizer to get re-ranking, drop, and add
          suggestions across the active backlog.
        </p>
      ) : (
        <>
          {review.risks.length > 0 && (
            <section className="rounded-xl border-2 border-red-300 bg-red-50/60 p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-red-800">
                <span>⚠</span>
                <span>项目风险 / Project risks ({review.risks.length})</span>
              </h2>
              <ul className="space-y-3">
                {review.risks.map((r, i) => (
                  <li
                    key={i}
                    className={`rounded-lg border p-3 ${
                      r.severity === "critical"
                        ? "border-red-400 bg-white"
                        : r.severity === "high"
                          ? "border-amber-300 bg-amber-50/60"
                          : "border-neutral-300 bg-white"
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="font-semibold text-neutral-900">{r.title}</h3>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wider ${
                          r.severity === "critical"
                            ? "bg-red-600 text-white"
                            : r.severity === "high"
                              ? "bg-amber-600 text-white"
                              : "bg-neutral-500 text-white"
                        }`}
                      >
                        {r.severity}
                      </span>
                    </div>
                    {r.source_label && (
                      <p className="mt-1 text-xs text-neutral-600">
                        Source ({r.source_type ?? "—"}): <span className="italic">{r.source_label}</span>
                      </p>
                    )}
                    {r.description && (
                      <p className="mt-2 text-sm text-neutral-800">{r.description}</p>
                    )}
                    {r.implications && (
                      <p className="mt-2 text-sm text-neutral-700">
                        <span className="font-medium">Implications:</span> {r.implications}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {review.overall_reasoning && (
            <div className="rounded-xl bg-neutral-50 p-4 text-sm text-neutral-700">
              <span className="font-medium">整体思路 / Overall:</span>{" "}
              {review.overall_reasoning}
            </div>
          )}

          <Section title="重排 / Reorder" empty="No reorder suggestions.">
            {review.reorder.map((r, i) => {
              const state = getItem("reorder", i);
              return (
                <SuggestionCard key={i} state={state}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        {taskTitles[r.task_id] ?? "(unknown task)"}
                        <span className="ml-2 text-xs text-neutral-500">
                          → priority {r.new_priority}
                        </span>
                      </p>
                      {r.reasoning && (
                        <p className="mt-1 text-sm text-neutral-600">{r.reasoning}</p>
                      )}
                      {state.action === "edit" && (
                        <input
                          type="number"
                          defaultValue={r.new_priority}
                          onChange={(e) =>
                            setItem("reorder", i, {
                              edit: { new_priority: Number(e.target.value) },
                            })
                          }
                          className="mt-2 w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
                        />
                      )}
                    </div>
                    <Actions
                      state={state}
                      onChange={(action) => setItem("reorder", i, { action, edit: null })}
                    />
                  </div>
                  <RejectChips
                    state={state}
                    onPick={(key) =>
                      setItem("reorder", i, {
                        reject_chip: state.reject_chip === key ? null : key,
                      })
                    }
                    onFree={(v) => setItem("reorder", i, { reject_free: v })}
                  />
                </SuggestionCard>
              );
            })}
          </Section>

          <Section title="删除 / Drops" empty="No drop suggestions.">
            {review.drops.map((d, i) => {
              const state = getItem("drops", i);
              return (
                <SuggestionCard key={i} state={state}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium line-through decoration-neutral-400">
                        {taskTitles[d.task_id] ?? "(unknown task)"}
                      </p>
                      {d.reason && (
                        <p className="mt-1 text-sm text-neutral-600">{d.reason}</p>
                      )}
                    </div>
                    <Actions
                      state={state}
                      onChange={(action) => setItem("drops", i, { action, edit: null })}
                      hideEdit
                    />
                  </div>
                  <RejectChips
                    state={state}
                    onPick={(key) =>
                      setItem("drops", i, {
                        reject_chip: state.reject_chip === key ? null : key,
                      })
                    }
                    onFree={(v) => setItem("drops", i, { reject_free: v })}
                  />
                </SuggestionCard>
              );
            })}
          </Section>

          <Section title="新增 / Adds" empty="No new task suggestions.">
            {review.adds.map((a, i) => {
              const state = getItem("adds", i);
              return (
                <SuggestionCard key={i} state={state}>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      {state.action === "edit" ? (
                        <input
                          type="text"
                          defaultValue={a.title}
                          onChange={(e) =>
                            setItem("adds", i, {
                              edit: { ...(state.edit ?? {}), title: e.target.value },
                            })
                          }
                          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm font-medium"
                        />
                      ) : (
                        <p className="font-medium">{a.title}</p>
                      )}
                      <p className="text-xs text-neutral-500">
                        {a.estimated_hours ? `${a.estimated_hours}h` : "—"}
                        {a.gap_filled ? ` · fills gap: ${a.gap_filled}` : ""}
                      </p>
                      {state.action === "edit" ? (
                        <textarea
                          defaultValue={a.description ?? ""}
                          onChange={(e) =>
                            setItem("adds", i, {
                              edit: {
                                ...(state.edit ?? {}),
                                description: e.target.value,
                              },
                            })
                          }
                          rows={2}
                          className="mt-1 w-full rounded border border-neutral-300 px-2 py-1 text-sm"
                        />
                      ) : (
                        a.description && (
                          <p className="mt-1 text-sm text-neutral-600">{a.description}</p>
                        )
                      )}
                      {a.reasoning && (
                        <p className="mt-1 text-xs italic text-neutral-500">
                          AI: {a.reasoning}
                        </p>
                      )}
                    </div>
                    <Actions
                      state={state}
                      onChange={(action) => setItem("adds", i, { action, edit: null })}
                    />
                  </div>
                  <RejectChips
                    state={state}
                    onPick={(key) =>
                      setItem("adds", i, {
                        reject_chip: state.reject_chip === key ? null : key,
                      })
                    }
                    onFree={(v) => setItem("adds", i, { reject_free: v })}
                  />
                </SuggestionCard>
              );
            })}
          </Section>

          <Section title="关键路径 / Critical path" empty="—">
            {review.critical_path.length > 0 && (
              <ol className="list-decimal space-y-1 pl-6 text-sm text-neutral-700">
                {review.critical_path.map((tid, i) => (
                  <li key={i}>{taskTitles[tid] ?? `(${tid.slice(0, 8)})`}</li>
                ))}
              </ol>
            )}
          </Section>

          <Section
            title="需要补的信息 / Unknowns"
            empty="AI 觉得信息足够 / no unknowns flagged."
          >
            {review.unknowns.length > 0 && (
              <ul className="list-disc space-y-1 pl-6 text-sm text-neutral-700">
                {review.unknowns.map((u, i) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            )}
          </Section>

          <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white px-6 py-3">
            <p className="text-xs text-neutral-500">
              {summary.accept} accept · {summary.edit} edit · {summary.reject} reject
            </p>
            <button
              onClick={onSubmit}
              disabled={submitting || running}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {submitting ? "Applying…" : "Apply decisions"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <section>
      <h3 className="mb-2 text-sm font-medium uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      {hasChildren ? (
        <ul className="space-y-2">{children}</ul>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-200 p-3 text-center text-xs text-neutral-400">
          {empty}
        </p>
      )}
    </section>
  );
}

function SuggestionCard({
  state,
  children,
}: {
  state: ItemState;
  children: React.ReactNode;
}) {
  const tone =
    state.action === "reject"
      ? "border-red-300 bg-red-50/40"
      : state.action === "edit"
        ? "border-amber-300 bg-amber-50/40"
        : "border-emerald-300 bg-emerald-50/40";
  // Children layout: each call site renders a header row (title + Actions)
  // wrapped in a flex-row, then RejectChips as a sibling. The card uses
  // space-y-2 so reject chips wrap to their own row instead of fighting
  // the title's flex-1 for width.
  return (
    <li className={`rounded-xl border p-3 ${tone}`}>
      <div className="space-y-2">{children}</div>
    </li>
  );
}

function Actions({
  state,
  onChange,
  hideEdit = false,
}: {
  state: ItemState;
  onChange: (action: "accept" | "edit" | "reject") => void;
  hideEdit?: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      <ActionBtn label="Accept" active={state.action === "accept"} onClick={() => onChange("accept")} tone="emerald" />
      {!hideEdit && (
        <ActionBtn label="Edit" active={state.action === "edit"} onClick={() => onChange("edit")} tone="amber" />
      )}
      <ActionBtn label="Reject" active={state.action === "reject"} onClick={() => onChange("reject")} tone="red" />
    </div>
  );
}

function RejectChips({
  state,
  onPick,
  onFree,
}: {
  state: ItemState;
  onPick: (key: string) => void;
  onFree: (v: string) => void;
}) {
  if (state.action !== "reject") return null;
  return (
    <div className="mt-2 w-full space-y-2">
      <div className="flex flex-wrap gap-1">
        {REJECT_CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => onPick(c.key)}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              state.reject_chip === c.key
                ? "border-red-400 bg-red-100 text-red-800"
                : "border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input
        type="text"
        value={state.reject_free}
        onChange={(e) => onFree(e.target.value)}
        placeholder="Or type a reason — helps the AI learn 优先级模型 / what 'priority' means here"
        className="w-full rounded border border-neutral-300 px-2 py-1 text-xs"
      />
    </div>
  );
}

function ActionBtn({
  label,
  active,
  onClick,
  tone,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone: "emerald" | "amber" | "red";
}) {
  const cls = active
    ? tone === "emerald"
      ? "bg-emerald-600 text-white"
      : tone === "amber"
        ? "bg-amber-600 text-white"
        : "bg-red-600 text-white"
    : "bg-white text-neutral-700 hover:bg-neutral-100 border border-neutral-300";
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-xs font-medium transition ${cls}`}
    >
      {label}
    </button>
  );
}
