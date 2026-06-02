"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AIText } from "@/components/almanac/AIText";
import { Bi } from "@/components/almanac/Bi";
import { Chip } from "@/components/almanac/Chip";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import {
  type QuestionRespondBody,
  resolveQuestion,
  respondToQuestion,
  runQuestions,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

type BlastRadius = { released_task_ids: string[]; count: number };

type Question = {
  id: string;
  question: string;
  question_zh: string | null;
  question_en: string | null;
  drafted_message_zh: string | null;
  drafted_message_en: string | null;
  status: string;
  dismiss_reason: string | null;
  feedback_note: string | null;
  blast_radius: BlastRadius | null;
  created_at: string;
  resolved_at: string | null;
  source_task_id: string | null;
  source_decision_id: string | null;
  target_owner_id: string | null;
  source_task: { id: string; title: string } | null;
  routed_owner: { id: string; name: string | null; email: string } | null;
};

/** Public alias for the page's server-side row shape (cast target). */
export type QuestionRow = Question;

type Teammate = { id: string; name: string | null; email: string };

const SELECT = `id, question, question_zh, question_en, drafted_message_zh, drafted_message_en,
  status, dismiss_reason, feedback_note, blast_radius, created_at, resolved_at,
  source_task_id, source_decision_id, target_owner_id,
  source_task:tasks!open_questions_source_task_id_fkey (id, title),
  routed_owner:users!open_questions_target_owner_id_fkey (id, name, email)`;

const DISMISS_CHIPS: { key: string; cn: string; en: string }[] = [
  { key: "not_blocking", cn: "不是阻塞", en: "Not blocking" },
  { key: "already_known", cn: "已经知道", en: "Already known" },
];

type Filter = "open" | "mine" | "resolved" | "all";

const FILTER_LABELS: Record<Filter, { cn: string; en: string }> = {
  open: { cn: "待处理", en: "Open" },
  mine: { cn: "我的", en: "Mine" },
  resolved: { cn: "已处理", en: "Resolved" },
  all: { cn: "全部", en: "All" },
};

const STATUS_LABELS: Record<string, { cn: string; en: string }> = {
  open: { cn: "待解答", en: "Open" },
  routed: { cn: "已认领", en: "Taken" },
  answered: { cn: "已落地", en: "Resolved" },
  dismissed: { cn: "已忽略", en: "Dismissed" },
};

type FormMode = "dismiss" | "edit" | "resolve";

export function QuestionsPanel({
  projectId,
  currentUserId,
  initialQuestions,
  taskTitles,
  teammates,
}: {
  projectId: string;
  currentUserId: string | null;
  initialQuestions: Question[];
  taskTitles: Record<string, string>;
  teammates: Teammate[];
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[]>(initialQuestions);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");
  const [open, setOpen] = useState<{ id: string; mode: FormMode } | null>(null);

  async function onDerive() {
    setRunning(true);
    setRunMessage(null);
    setError(null);
    try {
      const result = await runQuestions(projectId);
      setRunMessage(
        result.written === 0
          ? `Scanned ${result.candidate_count} candidate${result.candidate_count === 1 ? "" : "s"} — nothing new surfaced${result.dropped_dup ? `, ${result.dropped_dup} already known` : ""}. Mark tasks blocked/in_progress with downstream dependencies, then try again.`
          : `Framed ${result.written} new question${result.written === 1 ? "" : "s"} from ${result.candidate_count} candidate${result.candidate_count === 1 ? "" : "s"}.`,
      );
      const supabase = supabaseBrowser();
      const { data: refreshed } = await supabase
        .from("open_questions")
        .select(SELECT)
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (refreshed) setQuestions(refreshed as unknown as Question[]);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setRunning(false);
    }
  }

  async function onRespond(questionId: string, body: QuestionRespondBody) {
    setError(null);
    try {
      const res = await respondToQuestion(questionId, body);
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? {
                ...q,
                status: res.status,
                question: body.edited_question ?? q.question,
                drafted_message_zh: body.edited_outreach_zh ?? q.drafted_message_zh,
                drafted_message_en: body.edited_outreach_en ?? q.drafted_message_en,
                dismiss_reason: body.reason_chip ?? body.reason_free ?? q.dismiss_reason,
              }
            : q,
        ),
      );
      setOpen(null);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    }
  }

  async function onResolve(
    questionId: string,
    body: { answer_text: string; land_as: "decision" | "artifact" },
  ) {
    setError(null);
    try {
      await resolveQuestion(questionId, body);
      setQuestions((prev) =>
        prev.map((q) =>
          q.id === questionId
            ? { ...q, status: "answered", resolved_at: new Date().toISOString() }
            : q,
        ),
      );
      setOpen(null);
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    }
  }

  const filtered = questions.filter((q) => {
    if (filter === "mine") return q.target_owner_id === currentUserId;
    if (filter === "open") return q.status === "open" || q.status === "routed";
    if (filter === "resolved") return q.status === "answered" || q.status === "dismissed";
    return true;
  });

  return (
    <div className="almanac space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(["open", "mine", "resolved", "all"] as Filter[]).map((f) => (
            <Chip
              key={f}
              cn={FILTER_LABELS[f].cn}
              en={FILTER_LABELS[f].en}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onDerive}
          disabled={running}
          className="inline-flex items-center gap-1.5 bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
        >
          <Glyph name="sparkle" size={12} />
          {running ? (
            <Bi cn="推导中…" en="Deriving…" glossSize={0.78} />
          ) : (
            <Bi cn="刷新问题" en="Refresh queue" glossSize={0.78} />
          )}
        </button>
      </div>

      {runMessage && (
        <p className="border border-sage-soft bg-sage-soft/60 px-3 py-2 text-sm text-sage-ink">
          {runMessage}
        </p>
      )}
      {error && (
        <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
          {error}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
          <p className="text-sm text-ink-3">
            {questions.length === 0 ? (
              <Bi cn="还没有待解答的问题" en="No open questions yet" glossSize={0.78} />
            ) : (
              <Bi cn="当前筛选没有结果" en="Nothing matches this filter" glossSize={0.78} />
            )}
          </p>
          {questions.length === 0 && (
            <p className="mt-1 text-xs text-ink-4">
              Mark tasks blocked / in_progress with downstream dependencies, then Refresh queue · 把有下游依赖的任务标为 blocked/进行中后再刷新
            </p>
          )}
        </div>
      ) : (
        <ul className="border-t border-rule">
          {filtered.map((q) => (
            <OpenQuestionCard
              key={q.id}
              q={q}
              currentUserId={currentUserId}
              taskTitles={taskTitles}
              teammates={teammates}
              openForm={open?.id === q.id ? open.mode : null}
              setOpenForm={(mode) => setOpen(mode ? { id: q.id, mode } : null)}
              onRespond={onRespond}
              onResolve={onResolve}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OpenQuestionCard({
  q,
  currentUserId,
  taskTitles,
  teammates,
  openForm,
  setOpenForm,
  onRespond,
  onResolve,
}: {
  q: Question;
  currentUserId: string | null;
  taskTitles: Record<string, string>;
  teammates: Teammate[];
  openForm: FormMode | null;
  setOpenForm: (mode: FormMode | null) => void;
  onRespond: (id: string, body: QuestionRespondBody) => void;
  onResolve: (id: string, body: { answer_text: string; land_as: "decision" | "artifact" }) => void;
}) {
  const statusLbl = STATUS_LABELS[q.status] ?? { cn: q.status, en: q.status };
  const isResolved = q.status === "answered" || q.status === "dismissed";
  const rowBg =
    q.status === "dismissed"
      ? "bg-paper-2/60 opacity-70"
      : q.status === "answered"
        ? "bg-sage-soft/40"
        : "bg-paper";

  const blast = q.blast_radius;
  const releasedIds = blast?.released_task_ids ?? [];
  const count = blast?.count ?? releasedIds.length;
  const ownerLabel = q.routed_owner?.name || q.routed_owner?.email || "未分配 / unassigned";
  const isMine = q.target_owner_id && q.target_owner_id === currentUserId;

  return (
    <li className={`border-b border-rule ${rowBg}`}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <Micro>
              <span className="font-sc text-ink-2">
                {q.source_task?.title ?? (q.source_decision_id ? "决策复核 / decision review" : "—")}
              </span>
            </Micro>
            <AIText as="p" className="mt-2 text-sm leading-relaxed text-ink">
              {q.question}
            </AIText>

            {/* Unblock blast radius — the differentiator */}
            {count > 0 && (
              <div className="mt-2 border-l-2 border-clay bg-paper-2/60 px-3 py-2">
                <Micro>
                  <Bi cn="解答后释放" en="Answering this unblocks" glossSize={0.78} /> · {count}
                </Micro>
                <p className="mt-1 text-xs text-ink-2">
                  {releasedIds.map((id) => taskTitles[id] ?? "(task)").join(" · ")}
                </p>
              </div>
            )}

            {/* Routed owner */}
            <p className="mt-2 text-xs text-ink-3">
              <Bi cn="负责人" en="Routed to" glossSize={0.78} />: {ownerLabel}
              {isMine && (
                <span className="ml-1 font-mono text-[10px] uppercase tracking-[0.08em] text-clay-deep">
                  · <Bi cn="是你" en="that's you" glossSize={0.85} />
                </span>
              )}
            </p>

            {/* Copyable bilingual outreach */}
            {(q.drafted_message_zh || q.drafted_message_en) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-ink-2 hover:text-ink">
                  <Bi cn="外联草稿" en="Outreach draft" glossSize={0.78} />
                </summary>
                <div className="mt-2 space-y-2">
                  <OutreachBlock label="中文" text={q.drafted_message_zh} />
                  <OutreachBlock label="EN" text={q.drafted_message_en} />
                </div>
              </details>
            )}

            {(q.dismiss_reason || q.feedback_note) && (
              <p className="mt-2 text-xs text-ink-3">
                {q.dismiss_reason && (
                  <>
                    <Bi cn="原因" en="Reason" glossSize={0.78} />: {q.dismiss_reason}
                  </>
                )}
                {q.feedback_note && (
                  <>
                    {" · "}
                    <Bi cn="备注" en="Note" glossSize={0.78} />: {q.feedback_note}
                  </>
                )}
              </p>
            )}
          </div>
          <span className="shrink-0 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            <Bi cn={statusLbl.cn} en={statusLbl.en} glossSize={0.85} />
          </span>
        </div>

        {!isResolved && (
          <div className="mt-3 border-t border-rule pt-3">
            {openForm === "dismiss" ? (
              <DismissForm
                onSubmit={(chip, free) =>
                  onRespond(q.id, { action: "dismiss", reason_chip: chip, reason_free: free })
                }
                onCancel={() => setOpenForm(null)}
              />
            ) : openForm === "edit" ? (
              <EditForm
                q={q}
                teammates={teammates}
                onSubmit={(body) => onRespond(q.id, { action: "edit", ...body })}
                onCancel={() => setOpenForm(null)}
              />
            ) : openForm === "resolve" ? (
              <ResolveForm
                q={q}
                onSubmit={(body) => onResolve(q.id, body)}
                onCancel={() => setOpenForm(null)}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onRespond(q.id, { action: "accept" })}
                  className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
                >
                  <Bi cn="我来跟进" en="Take it" glossSize={0.78} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenForm("edit")}
                  className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
                >
                  <Bi cn="改写·改派" en="Re-frame · Reassign" glossSize={0.78} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenForm("resolve")}
                  className="border border-sage-soft bg-paper px-3 py-1 text-xs text-sage-ink transition hover:bg-sage-soft/50"
                >
                  <Bi cn="我有答案·落地" en="I have the answer → land it" glossSize={0.78} />
                </button>
                <button
                  type="button"
                  onClick={() => setOpenForm("dismiss")}
                  className="border border-rust-soft bg-paper px-3 py-1 text-xs text-rust-ink transition hover:bg-rust-soft/50"
                >
                  <Bi cn="忽略·标注原因" en="Dismiss with reason" glossSize={0.78} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function OutreachBlock({ label, text }: { label: string; text: string | null }) {
  if (!text) return null;
  return (
    <div className="border border-rule bg-paper px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-4">{label}</span>
        <CopyButton text={text} />
      </div>
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — no-op */
        }
      }}
      className="text-[11px] text-ink-3 transition hover:text-ink"
    >
      {copied ? <Bi cn="已复制 ✓" en="Copied ✓" glossSize={0.78} /> : <Bi cn="复制" en="Copy" glossSize={0.78} />}
    </button>
  );
}

function DismissForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (chip: string | null, free: string | null) => void;
  onCancel: () => void;
}) {
  const [chip, setChip] = useState<string | null>(null);
  const [free, setFree] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {DISMISS_CHIPS.map((c) => (
          <Chip
            key={c.key}
            cn={c.cn}
            en={c.en}
            active={chip === c.key}
            onClick={() => setChip(chip === c.key ? null : c.key)}
          />
        ))}
      </div>
      <input
        type="text"
        value={free}
        onChange={(e) => setFree(e.target.value)}
        placeholder="Or type why — the AI uses this to filter future questions · 用一句话写原因，AI 会用于过滤后续问题"
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3 hover:text-ink"
        >
          <Bi cn="取消" en="Cancel" glossSize={0.78} />
        </button>
        <button
          type="button"
          onClick={() => onSubmit(chip, free.trim() || null)}
          disabled={!chip && !free.trim()}
          className="bg-rust px-3 py-1 text-xs font-medium text-paper transition hover:bg-rust-ink disabled:opacity-40"
        >
          <Bi cn="忽略" en="Dismiss" glossSize={0.78} />
        </button>
      </div>
    </div>
  );
}

function EditForm({
  q,
  teammates,
  onSubmit,
  onCancel,
}: {
  q: Question;
  teammates: Teammate[];
  onSubmit: (body: {
    edited_question?: string;
    edited_outreach_zh?: string;
    edited_outreach_en?: string;
    edited_owner_id?: string;
  }) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState(q.question);
  const [zh, setZh] = useState(q.drafted_message_zh ?? "");
  const [en, setEn] = useState(q.drafted_message_en ?? "");
  const [owner, setOwner] = useState(q.target_owner_id ?? "");
  return (
    <div className="space-y-2">
      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
        placeholder="Re-frame the question"
      />
      <textarea
        value={zh}
        onChange={(e) => setZh(e.target.value)}
        rows={2}
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
        placeholder="中文外联草稿"
      />
      <textarea
        value={en}
        onChange={(e) => setEn(e.target.value)}
        rows={2}
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
        placeholder="English outreach draft"
      />
      <select
        value={owner}
        onChange={(e) => setOwner(e.target.value)}
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
      >
        <option value="">— reassign owner —</option>
        {teammates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name || t.email}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3 hover:text-ink"
        >
          <Bi cn="取消" en="Cancel" glossSize={0.78} />
        </button>
        <button
          type="button"
          onClick={() =>
            onSubmit({
              edited_question: question.trim() || undefined,
              edited_outreach_zh: zh.trim() || undefined,
              edited_outreach_en: en.trim() || undefined,
              edited_owner_id: owner || undefined,
            })
          }
          className="bg-ink px-3 py-1 text-xs font-medium text-paper transition hover:bg-clay-deep"
        >
          <Bi cn="保存·认领" en="Save · Take it" glossSize={0.78} />
        </button>
      </div>
    </div>
  );
}

function ResolveForm({
  q,
  onSubmit,
  onCancel,
}: {
  q: Question;
  onSubmit: (body: { answer_text: string; land_as: "decision" | "artifact" }) => void;
  onCancel: () => void;
}) {
  const [answer, setAnswer] = useState("");
  const [landAs, setLandAs] = useState<"decision" | "artifact">(
    q.source_decision_id ? "decision" : "artifact",
  );
  return (
    <div className="space-y-2">
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        className="w-full border border-rule bg-paper px-3 py-2 text-xs text-ink outline-none transition focus:border-ink"
        placeholder="What's the real-world answer? · 写下你拿到的真实答案"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Micro>
          <Bi cn="落地为" en="Land as" glossSize={0.78} />
        </Micro>
        <Chip cn="决策" en="Decision" active={landAs === "decision"} onClick={() => setLandAs("decision")} />
        <Chip cn="资料" en="Artifact" active={landAs === "artifact"} onClick={() => setLandAs("artifact")} />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3 hover:text-ink"
        >
          <Bi cn="取消" en="Cancel" glossSize={0.78} />
        </button>
        <button
          type="button"
          onClick={() => onSubmit({ answer_text: answer.trim(), land_as: landAs })}
          disabled={!answer.trim()}
          className="bg-sage px-3 py-1 text-xs font-medium text-paper transition hover:bg-sage-ink disabled:opacity-40"
        >
          <Bi cn="落地" en="Land it" glossSize={0.78} />
        </button>
      </div>
    </div>
  );
}
