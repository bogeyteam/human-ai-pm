"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ProposalReview } from "@/components/almanac/ProposalReview";
import type {
  Proposal,
  ProposalReviewResult,
  RejectReason,
} from "@/components/almanac/ProposalReview";
import {
  generateTasks,
  persistTasks,
  type GenerateTasksResponse,
  type PersistDecision,
  type TaskProposal,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";

/**
 * Task-gen-specific reject reasons. The Almanac ProposalReview ships a
 * general-purpose set; we override with the chips the M5 backend feedback
 * loop already understands (matches the legacy REJECT_CHIPS keys).
 */
const TASK_GEN_REJECT_REASONS: RejectReason[] = [
  { id: "already_done", cn: "已经做过", en: "Already done" },
  { id: "wrong_stage", cn: "阶段不对", en: "Wrong stage" },
  { id: "too_coarse", cn: "颗粒度太粗", en: "Too coarse" },
  { id: "too_granular", cn: "颗粒度太细", en: "Too granular" },
  { id: "not_our_scope", cn: "不该我们做", en: "Not our scope" },
  { id: "low_priority", cn: "优先级太低", en: "Low priority" },
];

type Phase = "input" | "generating" | "review" | "submitting" | "done";

export function BrainstormToTasks({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("input");
  const [brainstorm, setBrainstorm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateTasksResponse | null>(null);
  const [reflection, setReflection] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setPhase("input");
    setBrainstorm("");
    setError(null);
    setResult(null);
    setReflection(null);
  }

  async function onGenerate() {
    setError(null);
    setPhase("generating");
    try {
      const data = await generateTasks(projectId, { brainstorm });
      setResult(data);
      setPhase("review");
    } catch (err) {
      setError(extractError(err));
      setPhase("input");
    }
  }

  /**
   * Map the M5 TaskProposal payload to the Almanac Proposal shape that
   * ProposalReview consumes. Task titles in real data are mixed CN/EN
   * single strings; we pass the same value to both slots and let the Bi
   * primitive render it. Confidence is synthesized from is_critical_path
   * because the backend doesn't return a confidence field today (see notes).
   */
  const proposals: Proposal[] = useMemo(() => {
    if (!result) return [];
    return result.proposals.map((p: TaskProposal): Proposal => {
      const metaParts: { owner?: string; estimate?: string; deadline?: string } = {};
      if (p.suggested_owner_email) metaParts.owner = p.suggested_owner_email;
      if (p.estimated_hours != null) metaParts.estimate = `${p.estimated_hours}h`;
      if (p.is_critical_path) metaParts.deadline = "critical path";
      const isUpdate = Boolean(p.updates_task_id);
      return {
        id: String(p.index),
        kind: "task-gen",
        target: {
          type: "task",
          id: isUpdate ? p.updates_task_id! : `T-${p.index}`,
          titleCn: isUpdate ? (p.updates_task_title ?? p.title) : p.title,
          titleEn: isUpdate ? (p.updates_task_title ?? p.title) : p.title,
        },
        before: isUpdate
          ? {
              titleCn: p.updates_task_title ?? "",
              titleEn: p.updates_task_title ?? "",
              descCn: "",
              descEn: "",
            }
          : null,
        after: {
          titleCn: p.title,
          titleEn: p.title,
          descCn: p.description ?? "",
          descEn: p.description ?? "",
          meta: Object.keys(metaParts).length > 0 ? metaParts : undefined,
        },
        rationaleAi: p.reasoning ?? "",
        rationaleAiCn: p.reasoning ?? "",
        confidence: p.is_critical_path ? 0.88 : 0.72,
      };
    });
  }, [result]);

  async function handleApply(results: ProposalReviewResult[]) {
    if (!result) return;
    setError(null);
    setPhase("submitting");
    try {
      const proposalMap = new Map(result.proposals.map((p) => [String(p.index), p]));
      const decisions: PersistDecision[] = [];
      for (const r of results) {
        const index = parseInt(r.proposalId, 10);
        if (Number.isNaN(index)) continue;
        const proposal = proposalMap.get(r.proposalId);
        const updates_task_id = proposal?.updates_task_id ?? null;
        // Treat "skip" as a reject with no reason — backend doesn't know
        // skip and the feedback loop is happy with an empty-reason reject.
        if (r.decision === "skip") {
          decisions.push({ index, action: "reject", updates_task_id });
          continue;
        }
        if (r.decision === "reject") {
          decisions.push({
            index,
            action: "reject",
            reject_reason_chip: r.reasonId ?? null,
            updates_task_id,
          });
          continue;
        }
        if (r.decision === "edit") {
          decisions.push({
            index,
            action: "edit",
            title: r.editedText ?? undefined,
            updates_task_id,
          });
          continue;
        }
        decisions.push({ index, action: "accept", updates_task_id });
      }

      const res = await persistTasks(projectId, {
        manager_action_id: result.manager_action_id,
        decisions,
      });

      const topReject = mostCommonChip(results);
      setReflection(
        `AI 这次: ${res.summary.accepted} accepted, ${res.summary.edited} edited, ${res.summary.rejected} rejected` +
          (topReject ? ` (mostly: ${topReject})` : ""),
      );
      setPhase("done");
      router.refresh();
    } catch (err) {
      setError(extractError(err));
      setPhase("review");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
      >
        ✨ Generate tasks from brainstorm
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className={
              phase === "review" || phase === "submitting"
                ? "max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl"
                : "max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            }
          >
            {phase !== "review" && phase !== "submitting" && (
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">Generate tasks from brainstorm</h2>
                <button
                  onClick={reset}
                  className="text-sm text-neutral-500 hover:text-neutral-900"
                >
                  ✕
                </button>
              </div>
            )}

            {error && phase !== "review" && phase !== "submitting" && (
              <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}

            {(phase === "input" || phase === "generating") && (
              <div className="space-y-3">
                <textarea
                  rows={10}
                  value={brainstorm}
                  onChange={(e) => setBrainstorm(e.target.value)}
                  disabled={phase === "generating"}
                  placeholder="Paste a brainstorm, PRD excerpt, or rough idea here..."
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={reset}
                    className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onGenerate}
                    disabled={brainstorm.length < 10 || phase === "generating"}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {phase === "generating" ? "Generating…" : "Generate"}
                  </button>
                </div>
              </div>
            )}

            {(phase === "review" || phase === "submitting") && result && (
              <div className="flex h-[85vh] flex-col">
                {error && (
                  <div className="m-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                    {error}
                  </div>
                )}
                <div className="flex-1 overflow-hidden">
                  <ProposalReview
                    source="task-gen"
                    proposals={proposals}
                    onApply={handleApply}
                    onCancel={reset}
                    rejectReasons={TASK_GEN_REJECT_REASONS}
                    embedded
                  />
                </div>
              </div>
            )}

            {phase === "done" && (
              <div className="space-y-4">
                <p className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">
                  ✓ {reflection}
                </p>
                <p className="text-xs text-neutral-500">
                  The next time you run this, the AI will see your rejections and try to avoid similar suggestions.
                </p>
                <div className="flex justify-end">
                  <button
                    onClick={reset}
                    className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Pick the most-used reject reason for the reflection summary. Falls back
 * to the chip id when the label lookup misses.
 */
function mostCommonChip(results: ProposalReviewResult[]): string | null {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (r.decision !== "reject") continue;
    const key = r.reasonId ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  const reason = TASK_GEN_REJECT_REASONS.find((r) => r.id === best);
  return reason ? `${reason.cn} / ${reason.en}` : best;
}
