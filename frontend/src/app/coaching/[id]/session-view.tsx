import type { CloseCoachingResponse } from "@/lib/api";

import { SessionResultView } from "../coaching-panel";

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type ParsedInsights = {
  result: CloseCoachingResponse | null;
  rating: "useful" | "not_useful" | null;
  ratingNote: string | null;
  transcriptAnswers: Array<{
    category?: string;
    prompt?: string;
    text?: string;
  }>;
};

function parseInsights(raw: Json | null | undefined): ParsedInsights {
  const empty: ParsedInsights = {
    result: null,
    rating: null,
    ratingNote: null,
    transcriptAnswers: [],
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, Json | undefined>;

  const insights = Array.isArray(obj.insights)
    ? (obj.insights.filter((x) => typeof x === "string") as string[])
    : [];
  const affirmations = Array.isArray(obj.affirmations)
    ? (obj.affirmations.filter((x) => typeof x === "string") as string[])
    : [];
  const closing_note =
    typeof obj.closing_note === "string" ? obj.closing_note : "";

  const result: CloseCoachingResponse | null =
    insights.length || affirmations.length || closing_note
      ? { insights, affirmations, closing_note }
      : null;

  const ratingRaw = obj.user_rating;
  const rating =
    ratingRaw === "useful" || ratingRaw === "not_useful" ? ratingRaw : null;
  const ratingNote =
    typeof obj.rating_note === "string" ? obj.rating_note : null;

  const transcriptAnswersRaw = obj.transcript_answers;
  const transcriptAnswers: ParsedInsights["transcriptAnswers"] = Array.isArray(
    transcriptAnswersRaw,
  )
    ? transcriptAnswersRaw.flatMap((a) => {
        if (!a || typeof a !== "object" || Array.isArray(a)) return [];
        const o = a as Record<string, Json | undefined>;
        const entry: ParsedInsights["transcriptAnswers"][number] = {
          category: typeof o.category === "string" ? o.category : undefined,
          prompt: typeof o.prompt === "string" ? o.prompt : undefined,
          text: typeof o.text === "string" ? o.text : undefined,
        };
        return [entry];
      })
    : [];

  return { result, rating, ratingNote, transcriptAnswers };
}

export function SessionView({
  insights,
  transcript,
}: {
  insights: Json | null;
  transcript: string | null;
}) {
  const parsed = parseInsights(insights);

  return (
    <div className="space-y-5">
      {parsed.rating && (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-neutral-500">
            Your rating · 你的评价
          </span>
          <RatingChip rating={parsed.rating} />
          {parsed.ratingNote && (
            <span className="text-sm text-neutral-700">
              · &ldquo;{parsed.ratingNote}&rdquo;
            </span>
          )}
        </div>
      )}

      {parsed.result ? (
        <SessionResultView result={parsed.result} />
      ) : (
        <p className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
          This session was started but never closed. ·
          这次会话已开始但未完成。
        </p>
      )}

      {parsed.transcriptAnswers.length > 0 && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            Your reflections · 你的回答
          </h2>
          <ul className="mt-3 space-y-4">
            {parsed.transcriptAnswers.map((a, i) => (
              <li
                key={i}
                className="rounded-xl border border-neutral-200 bg-neutral-50 p-3"
              >
                {a.prompt && (
                  <p className="text-sm font-medium text-neutral-900">{a.prompt}</p>
                )}
                {a.text && (
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-neutral-700">
                    {a.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {transcript && parsed.transcriptAnswers.length === 0 && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-medium uppercase tracking-wider text-neutral-500">
            Transcript · 记录
          </h2>
          <pre className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">
            {transcript}
          </pre>
        </section>
      )}
    </div>
  );
}

function RatingChip({ rating }: { rating: "useful" | "not_useful" }) {
  if (rating === "useful") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
        👍 useful
      </span>
    );
  }
  return (
    <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700">
      👎 not useful
    </span>
  );
}
