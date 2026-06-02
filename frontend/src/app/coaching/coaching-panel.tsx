"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  closeCoaching,
  rateCoaching,
  startCoaching,
  type CloseCoachingResponse,
  type ReflectionPrompt,
  type StartCoachingResponse,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";

export type PastSession = {
  id: string;
  created_at: string;
  rating: "useful" | "not_useful" | null;
  preview: string;
};

type Phase =
  | "idle"
  | "loading_start"
  | "open"
  | "loading_close"
  | "closed"
  | "loading_rate"
  | "rated";

const CATEGORY_LABELS: Record<string, string> = {
  completion: "完成 / Completion",
  estimation_drift: "偏估 / Estimation drift",
  stuck_tasks: "卡住 / Stuck tasks",
  disagreements: "分歧 / Disagreements",
  work_style: "工作风格 / Work style",
};

export function CoachingPanel({
  pastSessions,
  // Privacy-belt-and-suspenders: kept in props so future client features
  // (filters, optimistic insertions) can re-verify ownership client-side.
  currentUserId: _currentUserId,
}: {
  pastSessions: PastSession[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  // Live session state.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [opener, setOpener] = useState<string>("");
  const [prompts, setPrompts] = useState<ReflectionPrompt[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [openTime, setOpenTime] = useState<number | null>(null);

  // Close response.
  const [closeResult, setCloseResult] = useState<CloseCoachingResponse | null>(
    null,
  );

  // Rating state.
  const [ratingNote, setRatingNote] = useState("");

  function resetToIdle() {
    setPhase("idle");
    setError(null);
    setSessionId(null);
    setOpener("");
    setPrompts([]);
    setAnswers([]);
    setOpenTime(null);
    setCloseResult(null);
    setRatingNote("");
  }

  async function onStart() {
    setError(null);
    setPhase("loading_start");
    try {
      const data: StartCoachingResponse = await startCoaching();
      setSessionId(data.session_id);
      setOpener(data.opener);
      setPrompts(data.reflection_prompts);
      setAnswers(new Array(data.reflection_prompts.length).fill(""));
      setOpenTime(Date.now());
      setPhase("open");
    } catch (err) {
      setError(extractError(err));
      setPhase("idle");
    }
  }

  async function onContinue() {
    if (!sessionId) return;
    setError(null);
    setPhase("loading_close");
    try {
      const payloadAnswers = answers
        .map((text, prompt_index) => ({ prompt_index, text: text.trim() }))
        .filter((a) => a.text.length > 0);
      const duration_ms = openTime ? Date.now() - openTime : undefined;
      const data = await closeCoaching(sessionId, {
        answers: payloadAnswers,
        duration_ms,
      });
      setCloseResult(data);
      setPhase("closed");
    } catch (err) {
      setError(extractError(err));
      setPhase("open");
    }
  }

  async function onRate(rating: "useful" | "not_useful") {
    if (!sessionId) return;
    setError(null);
    setPhase("loading_rate");
    try {
      await rateCoaching(sessionId, {
        rating,
        note: ratingNote.trim() || undefined,
      });
      setPhase("rated");
      // Refresh server-side list so the new session shows up when the user
      // navigates back.
      router.refresh();
    } catch (err) {
      setError(extractError(err));
      setPhase("closed");
    }
  }

  function setAnswer(i: number, text: string) {
    setAnswers((prev) => prev.map((a, idx) => (idx === i ? text : a)));
  }

  // ── Idle / list view ────────────────────────────────────────────────
  if (phase === "idle" || phase === "loading_start") {
    return (
      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={onStart}
          disabled={phase === "loading_start"}
          className="w-full rounded-2xl bg-neutral-900 px-6 py-4 text-base font-medium text-white shadow-sm transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {phase === "loading_start" ? "Opening…" : "✨ Start a new session · 开始新会话"}
        </button>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-neutral-500">
            Past sessions · 过去的会话
          </h2>
          {pastSessions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
              No sessions yet · 暂无会话
            </p>
          ) : (
            <ul className="space-y-2">
              {pastSessions.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/coaching/${s.id}` as Route}
                    className="block rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-400"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-neutral-900">
                        {formatDate(s.created_at)}
                      </p>
                      <RatingChip rating={s.rating} />
                    </div>
                    {s.preview && (
                      <p className="mt-2 text-sm text-neutral-600 line-clamp-2">
                        {s.preview}
                        {s.preview.length >= 80 ? "…" : ""}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  // ── Open / answering ────────────────────────────────────────────────
  if (phase === "open" || phase === "loading_close") {
    return (
      <div className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-wider text-neutral-500">
            Opener · 开场
          </p>
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-neutral-900">
            {opener}
          </p>
        </div>

        <ul className="space-y-4">
          {prompts.map((p, i) => (
            <li
              key={i}
              className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-2 inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-700">
                {CATEGORY_LABELS[p.category] ?? p.category}
              </div>
              <p className="text-base font-medium text-neutral-900">{p.prompt}</p>
              {p.data_hook && (
                <p className="mt-1 text-xs italic text-neutral-500">
                  Why I&apos;m asking · 为什么问: {p.data_hook}
                </p>
              )}
              <textarea
                value={answers[i] ?? ""}
                onChange={(e) => setAnswer(i, e.target.value)}
                disabled={phase === "loading_close"}
                rows={5}
                placeholder="Write a few lines, or skip · 写几句，或跳过"
                className="mt-3 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-neutral-500"
              />
              <div className="mt-1 text-right">
                <button
                  type="button"
                  onClick={() => setAnswer(i, "")}
                  disabled={phase === "loading_close" || !answers[i]}
                  className="text-xs text-neutral-500 hover:underline disabled:cursor-default disabled:text-neutral-300 disabled:no-underline"
                >
                  Skip · 跳过
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={resetToIdle}
            disabled={phase === "loading_close"}
            className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
          >
            Cancel · 取消
          </button>
          <button
            onClick={onContinue}
            disabled={phase === "loading_close"}
            className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
          >
            {phase === "loading_close" ? "Reflecting…" : "Continue · 继续"}
          </button>
        </div>
        <p className="text-xs text-neutral-500">
          Empty answers are fine — they&apos;ll be skipped. 空白也没关系，会跳过。
        </p>
      </div>
    );
  }

  // ── Closed (insights + rating) ─────────────────────────────────────
  if (phase === "closed" || phase === "loading_rate") {
    return (
      <div className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {closeResult && <SessionResultView result={closeResult} />}

        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <p className="text-base font-medium text-neutral-900">
            Was this useful? · 这次对话有帮助吗?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onRate("useful")}
              disabled={phase === "loading_rate"}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              👍 Useful · 有帮助
            </button>
            <button
              onClick={() => onRate("not_useful")}
              disabled={phase === "loading_rate"}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            >
              👎 Not useful · 没用
            </button>
          </div>
          <textarea
            value={ratingNote}
            onChange={(e) => setRatingNote(e.target.value)}
            disabled={phase === "loading_rate"}
            rows={2}
            placeholder="Tell me more · 想多说几句 (optional / 可选)"
            className="mt-3 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
          <p className="mt-2 text-xs italic text-neutral-500">
            The note stays private with the rest of the session. 评价也只有你能看到。
          </p>
        </div>
      </div>
    );
  }

  // ── Rated / thank-you ──────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <p className="text-lg font-medium text-neutral-900">
          Thanks. See you next time.
        </p>
        <p className="mt-1 text-sm text-neutral-600">谢谢，下次再聊。</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={resetToIdle}
            className="rounded-lg border border-neutral-300 bg-white px-5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Back to sessions · 返回会话列表
          </button>
          <Link
            href="/projects"
            className="rounded-lg bg-neutral-900 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Back to projects · 返回项目
          </Link>
        </div>
      </div>
    </div>
  );
}

function RatingChip({
  rating,
}: {
  rating: "useful" | "not_useful" | null;
}) {
  if (rating === "useful") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        👍 useful
      </span>
    );
  }
  if (rating === "not_useful") {
    return (
      <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
        👎 not useful
      </span>
    );
  }
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs text-neutral-500">
      pending
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Shared closed-phase result renderer. Exported so the historical session
// page can render the same shape from a stored JSON blob.
export function SessionResultView({ result }: { result: CloseCoachingResponse }) {
  return (
    <div className="space-y-4">
      {result.insights.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            Insights · 洞察
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-neutral-900">
            {result.insights.map((it, i) => (
              <li key={i}>{it}</li>
            ))}
          </ul>
        </section>
      )}
      {result.affirmations.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            What you&apos;re doing well · 你做得好的地方
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-neutral-900">
            {result.affirmations.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      {result.closing_note && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            Closing thought · 结束语
          </h2>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-neutral-900">
            {result.closing_note}
          </p>
        </section>
      )}
    </div>
  );
}
