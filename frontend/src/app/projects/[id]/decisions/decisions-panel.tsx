"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Decision = {
  id: string;
  question: string;
  decision: string;
  reasoning: string | null;
  alternatives_considered: string | null;
  decided_at: string;
  review_at: string | null;
  users: { name: string | null; email: string } | null;
};

export function DecisionsPanel({
  projectId,
  initialDecisions,
}: {
  projectId: string;
  initialDecisions: Decision[];
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [decision, setDecision] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [reviewWeeks, setReviewWeeks] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || !decision.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const reviewAt = reviewWeeks
        ? new Date(Date.now() + Number(reviewWeeks) * 7 * 24 * 3600 * 1000).toISOString()
        : null;
      const { data, error } = await supabase
        .from("decisions")
        .insert({
          project_id: projectId,
          question: question.trim(),
          decision: decision.trim(),
          reasoning: reasoning.trim() || null,
          alternatives_considered: alternatives.trim() || null,
          decided_by: user?.id ?? null,
          review_at: reviewAt,
        })
        .select(
          "id, question, decision, reasoning, alternatives_considered, decided_at, review_at, users:decided_by(name, email)",
        )
        .single();
      if (error) throw error;
      setDecisions((prev) => [data as Decision, ...prev]);
      setQuestion("");
      setDecision("");
      setReasoning("");
      setAlternatives("");
      setReviewWeeks("");
      router.refresh();
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function applyUpdate(updated: Decision) {
    setDecisions((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  function applyDelete(id: string) {
    setDecisions((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="almanac grid grid-cols-1 gap-8 lg:grid-cols-3">
      <section className="lg:col-span-2">
        <div className="mb-3 flex items-baseline justify-between">
          <Micro>
            <Bi cn="决策日志" en="Decisions" glossSize={0.78} />
          </Micro>
          <span className="font-mono text-xs text-ink-3" data-tabular>
            {decisions.length.toString().padStart(2, "0")}
          </span>
        </div>
        {decisions.length === 0 ? (
          <div className="border border-dashed border-rule bg-paper-2/60 px-6 py-10 text-center">
            <p className="text-sm text-ink-3">
              <Bi cn="还没有决策" en="No decisions logged yet" glossSize={0.78} />
            </p>
            <p className="mt-1 text-xs text-ink-4">
              <Bi
                cn="AI 用这些记录理解团队「为什么这么选」"
                en="The AI uses these to understand why the team made choices when planning future work"
                glossSize={0.78}
              />
            </p>
          </div>
        ) : (
          <ul className="border-t border-rule">
            {decisions.map((d) => (
              <li key={d.id} className="border-b border-rule">
                {editingId === d.id ? (
                  <DecisionEditForm
                    decision={d}
                    onCancel={() => setEditingId(null)}
                    onSaved={(updated) => {
                      applyUpdate(updated);
                      setEditingId(null);
                      router.refresh();
                    }}
                    onDeleted={(id) => {
                      applyDelete(id);
                      setEditingId(null);
                      router.refresh();
                    }}
                  />
                ) : (
                  <DecisionRow d={d} onEdit={() => setEditingId(d.id)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside>
        <div className="mb-3">
          <Micro>
            <Bi cn="新建决策" en="New decision" glossSize={0.78} />
          </Micro>
        </div>
        <form onSubmit={onSubmit} className="space-y-3 border border-rule bg-paper p-4">
          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="问题" en="Question" glossSize={0.78} />
            </Micro>
            <input
              type="text"
              required
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Which 3PL for US? · 美国选哪家 3PL？"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="决策" en="Decision (one sentence)" glossSize={0.78} />
            </Micro>
            <input
              type="text"
              required
              value={decision}
              onChange={(e) => setDecision(e.target.value)}
              placeholder="The choice in one sentence · 一句话写下决定"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="理由" en="Why (helps AI later)" glossSize={0.78} />
            </Micro>
            <textarea
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value)}
              placeholder="Context the AI should know · AI 后续推理用的上下文"
              rows={3}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-ink"
            />
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="备选方案" en="Alternatives considered (optional)" glossSize={0.78} />
            </Micro>
            <textarea
              value={alternatives}
              onChange={(e) => setAlternatives(e.target.value)}
              placeholder="What else was on the table · 其他考虑过的选项"
              rows={2}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-ink"
            />
          </label>

          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="N 周后复核" en="Review in N weeks (optional)" glossSize={0.78} />
            </Micro>
            <input
              type="number"
              min={0}
              value={reviewWeeks}
              onChange={(e) => setReviewWeeks(e.target.value)}
              placeholder="e.g. 4"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
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
              <Bi cn="记录决策" en="Log decision" glossSize={0.78} />
            )}
          </button>

          {error && (
            <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
              {error}
            </p>
          )}
        </form>
      </aside>
    </div>
  );
}

// ── Row (read mode) ────────────────────────────────────────────────

function DecisionRow({ d, onEdit }: { d: Decision; onEdit: () => void }) {
  return (
    <div className="group flex items-start gap-3 bg-paper px-4 py-5">
      <Glyph name="diamond" size={10} color="var(--clay)" style={{ marginTop: 8 }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm text-ink-3">{d.question}</p>
          <div className="flex shrink-0 items-center gap-3">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
              {new Date(d.decided_at).toLocaleDateString()}
              {" · "}
              {d.users?.name || d.users?.email || "—"}
            </span>
            <button
              type="button"
              onClick={onEdit}
              aria-label="Edit decision"
              className="inline-flex items-center gap-1 text-xs text-ink-4 opacity-0 transition hover:text-ink group-hover:opacity-100"
            >
              <Glyph name="pencil" size={11} />
              <Bi cn="编辑" en="Edit" glossSize={0.78} />
            </button>
          </div>
        </div>
        <p className="mt-1 font-sc text-base font-medium text-ink">{d.decision}</p>
        {d.reasoning && (
          <p className="mt-2 font-serif text-sm italic leading-relaxed text-ink-2">
            {d.reasoning}
          </p>
        )}
        {d.alternatives_considered && (
          <p className="mt-2 text-xs text-ink-3">
            <Bi cn="备选" en="Alternatives" glossSize={0.85} />
            {": "}
            {d.alternatives_considered}
          </p>
        )}
        {d.review_at && (
          <p className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ochre-ink">
            <Bi cn="复核" en="Review by" glossSize={0.85} />{" "}
            {new Date(d.review_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Edit form (inline) ─────────────────────────────────────────────

type DecisionPatch = {
  question?: string;
  decision?: string;
  reasoning?: string | null;
  alternatives_considered?: string | null;
  review_at?: string | null;
};

function DecisionEditForm({
  decision: d,
  onSaved,
  onCancel,
  onDeleted,
}: {
  decision: Decision;
  onSaved: (updated: Decision) => void;
  onCancel: () => void;
  onDeleted: (id: string) => void;
}) {
  const [question, setQuestion] = useState(d.question);
  const [decisionText, setDecisionText] = useState(d.decision);
  const [reasoning, setReasoning] = useState(d.reasoning ?? "");
  const [alternatives, setAlternatives] = useState(d.alternatives_considered ?? "");
  const [reviewAt, setReviewAt] = useState<string>(
    d.review_at ? d.review_at.slice(0, 10) : "",
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!question.trim() || !decisionText.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const patch: DecisionPatch = {
        question: question.trim(),
        decision: decisionText.trim(),
        reasoning: reasoning.trim() || null,
        alternatives_considered: alternatives.trim() || null,
        review_at: reviewAt ? new Date(reviewAt).toISOString() : null,
      };
      const { data, error: err } = await supabase
        .from("decisions")
        .update(patch)
        .eq("id", d.id)
        .select(
          "id, question, decision, reasoning, alternatives_considered, decided_at, review_at, users:decided_by(name, email)",
        )
        .single();
      if (err) throw err;
      onSaved(data as Decision);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error: err } = await supabase.from("decisions").delete().eq("id", d.id);
      if (err) throw err;
      onDeleted(d.id);
    } catch (err) {
      setError(extractError(err));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-start gap-3 bg-paper-2/60 px-4 py-5">
      <Glyph name="pencil" size={10} color="var(--clay)" style={{ marginTop: 8 }} />
      <div className="min-w-0 flex-1 space-y-3">
        <Micro>
          <Bi cn="编辑决策" en="Editing decision" glossSize={0.78} />
        </Micro>

        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="问题" en="Question" glossSize={0.78} />
          </Micro>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
          />
        </label>

        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="决策" en="Decision" glossSize={0.78} />
          </Micro>
          <input
            type="text"
            value={decisionText}
            onChange={(e) => setDecisionText(e.target.value)}
            className="w-full border border-rule bg-paper px-3 py-2 font-sc text-base text-ink outline-none transition focus:border-ink"
          />
        </label>

        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="理由" en="Why" glossSize={0.78} />
          </Micro>
          <textarea
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            rows={3}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-ink"
          />
        </label>

        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="备选方案" en="Alternatives considered" glossSize={0.78} />
          </Micro>
          <textarea
            value={alternatives}
            onChange={(e) => setAlternatives(e.target.value)}
            rows={2}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-ink"
          />
        </label>

        <label className="block">
          <Micro style={{ marginBottom: 6 }}>
            <Bi cn="复核日期" en="Review by (optional)" glossSize={0.78} />
          </Micro>
          <input
            type="date"
            value={reviewAt}
            onChange={(e) => setReviewAt(e.target.value)}
            className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
          />
        </label>

        {error && (
          <p className="border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-rust-ink">
                <Bi cn="确认删除？" en="Delete?" glossSize={0.78} />
              </span>
              <button
                type="button"
                onClick={remove}
                disabled={deleting}
                className="bg-rust px-3 py-1 text-xs font-medium text-paper transition hover:bg-rust-ink disabled:opacity-40"
              >
                {deleting ? "…" : "Confirm"}
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="border border-rule bg-paper px-3 py-1.5 text-sm text-ink-2 transition hover:bg-paper-3 hover:text-ink"
            >
              <Bi cn="取消" en="Cancel" glossSize={0.78} />
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !question.trim() || !decisionText.trim()}
              className="bg-ink px-4 py-1.5 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
            >
              {saving ? (
                <Bi cn="保存中…" en="Saving…" glossSize={0.78} />
              ) : (
                <Bi cn="保存" en="Save" glossSize={0.78} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
