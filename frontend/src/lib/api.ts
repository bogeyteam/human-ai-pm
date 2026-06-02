"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

async function withAuth(): Promise<HeadersInit> {
  const supabase = supabaseBrowser();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in.");
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Turn a non-2xx response into a clean, user-facing message. FastAPI returns
 * `{detail: "..."}` (or `{detail: [{msg, loc}, ...]}` for validation errors);
 * we surface that rather than dumping the raw body / status line into the UI.
 * The raw body is logged to the console for debugging.
 */
async function errorFromResponse(res: Response): Promise<Error> {
  const raw = await res.text();
  // eslint-disable-next-line no-console
  console.error(`API ${res.status} ${res.statusText} for ${res.url}: ${raw}`);

  let message = `${res.statusText || "Request failed"} (${res.status})`;
  try {
    const body = JSON.parse(raw) as { detail?: unknown };
    const detail = body?.detail;
    if (typeof detail === "string" && detail.trim()) {
      message = detail;
    } else if (Array.isArray(detail) && detail.length > 0) {
      // Pydantic validation errors: join the human-readable `msg` fields.
      message = detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
        .filter(Boolean)
        .join("; ");
    }
  } catch {
    // Body wasn't JSON — keep the status-line fallback above.
  }
  return new Error(message);
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    ...(init?.headers ?? {}),
    ...(await withAuth()),
  };
  const res = await fetch(`${BACKEND}${path}`, { ...init, headers });
  if (!res.ok) {
    throw await errorFromResponse(res);
  }
  return (await res.json()) as T;
}

// ─── Typed wrappers for M5 endpoints ────────────────────────────────

export type TaskProposal = {
  index: number;
  title: string;
  description: string | null;
  estimated_hours: number | null;
  is_critical_path: boolean;
  stage_alignment: string;
  suggested_owner_email: string | null;
  dependencies: number[];
  reasoning: string | null;
  updates_task_id: string | null;
  updates_task_title: string | null;
};

export type GenerateTasksResponse = {
  manager_action_id: string;
  proposals: TaskProposal[];
  overall_reasoning: string | null;
};

export type PersistDecision = {
  index: number;
  action: "accept" | "edit" | "reject";
  title?: string;
  description?: string | null;
  estimated_hours?: number | null;
  suggested_owner_id?: string | null;
  reject_reason_chip?: string | null;
  reject_reason_free?: string | null;
  updates_task_id?: string | null;
};

export type PersistTasksResponse = {
  persisted_task_ids: string[];
  summary: { accepted: number; edited: number; rejected: number };
};

export function generateTasks(
  projectId: string,
  body: { brainstorm: string; artifact_ids?: string[] },
): Promise<GenerateTasksResponse> {
  return api(`/api/projects/${projectId}/generate_tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function persistTasks(
  projectId: string,
  body: { manager_action_id: string; decisions: PersistDecision[] },
): Promise<PersistTasksResponse> {
  return api(`/api/projects/${projectId}/persist_tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M6 — Cross-task Info Discovery ─────────────────────────────────

export type DiscoverResponse = {
  finding_ids: string[];
  candidate_count: number;
  written: number;
};

export function discoverFindings(projectId: string): Promise<DiscoverResponse> {
  return api(`/api/projects/${projectId}/discover`, { method: "POST" });
}

export type FindingResponseBody = {
  action: "acknowledge" | "link" | "dismiss";
  reason_chip?: string | null;
  reason_free?: string | null;
  feedback_note?: string | null;
};

export function respondToFinding(
  findingId: string,
  body: FindingResponseBody,
): Promise<{ finding_id: string; status: string }> {
  return api(`/api/findings/${findingId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M7 — Weekly Backlog Optimizer ──────────────────────────────────

export type OptimizerReorderItem = {
  task_id: string;
  new_priority: number;
  reasoning: string | null;
};

export type OptimizerDropItem = {
  task_id: string;
  reason: string | null;
};

export type OptimizerAddItem = {
  title: string;
  description: string | null;
  estimated_hours: number | null;
  reasoning: string | null;
  gap_filled: string | null;
};

export type OptimizerRiskItem = {
  severity: "medium" | "high" | "critical";
  source_type: string | null;
  source_label: string | null;
  title: string;
  description: string | null;
  implications: string | null;
};

export type OptimizerReview = {
  risks: OptimizerRiskItem[];
  reorder: OptimizerReorderItem[];
  drops: OptimizerDropItem[];
  adds: OptimizerAddItem[];
  critical_path: string[];
  unknowns: string[];
  overall_reasoning: string | null;
};

export type RunOptimizerResponse = {
  manager_action_id: string;
  review: OptimizerReview;
};

export type OptimizerDecision = {
  kind: "reorder" | "drop" | "add";
  target_index: number;
  action: "accept" | "edit" | "reject";
  edit?: Record<string, unknown> | null;
  reject_reason_chip?: string | null;
  reject_reason_free?: string | null;
};

export type SubmitOptimizerDecisionsResponse = {
  summary: { accepted: number; edited: number; rejected: number };
  applied: { reorders: number; drops: number; adds: number };
};

export function runOptimizer(projectId: string): Promise<RunOptimizerResponse> {
  return api(`/api/projects/${projectId}/optimizer/run`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export function submitOptimizerDecisions(
  projectId: string,
  body: { manager_action_id: string; decisions: OptimizerDecision[] },
): Promise<SubmitOptimizerDecisionsResponse> {
  return api(`/api/projects/${projectId}/optimizer/decisions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M11 — Meeting Orchestrator ─────────────────────────────────────

export type PreBriefResponse = {
  manager_action_id: string;
  markdown: string;
};

export function generateMeetingPreBrief(meetingId: string): Promise<PreBriefResponse> {
  return api(`/api/meetings/${meetingId}/pre_brief`, { method: "POST" });
}

export type PreBriefRespondBody = {
  action: "accept" | "edit" | "reject";
  edited_markdown?: string | null;
  reason?: string | null;
};

export function respondToMeetingPreBrief(
  meetingId: string,
  body: PreBriefRespondBody,
): Promise<{ final_markdown: string | null }> {
  return api(`/api/meetings/${meetingId}/pre_brief/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type ActionItemProposal = {
  index: number;
  title: string;
  description: string | null;
  suggested_owner_email: string | null;
  estimated_hours: number | null;
  reasoning: string | null;
};

export type ExtractActionItemsResponse = {
  manager_action_id: string;
  summary: string;
  action_items: ActionItemProposal[];
};

export function extractMeetingActionItems(
  meetingId: string,
): Promise<ExtractActionItemsResponse> {
  return api(`/api/meetings/${meetingId}/post_summary`, { method: "POST" });
}

export type ActionItemDecision = {
  index: number;
  action: "accept" | "edit" | "reject";
  title?: string;
  description?: string | null;
  estimated_hours?: number | null;
  suggested_owner_id?: string | null;
  reject_reason_chip?: string | null;
  reject_reason_free?: string | null;
};

export type PersistActionItemsResponse = {
  persisted_task_ids: string[];
  summary: { accepted: number; edited: number; rejected: number };
};

export function persistMeetingActionItems(
  meetingId: string,
  body: { manager_action_id: string; decisions: ActionItemDecision[] },
): Promise<PersistActionItemsResponse> {
  return api(`/api/meetings/${meetingId}/post_summary/persist`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M17 — Coaching ─────────────────────────────────────────────────

export type ReflectionPrompt = {
  category: string;
  prompt: string;
  data_hook: string;
};

export type StartCoachingResponse = {
  session_id: string;
  opener: string;
  reflection_prompts: ReflectionPrompt[];
};

export function startCoaching(): Promise<StartCoachingResponse> {
  return api(`/api/coaching/start`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export type CoachingAnswer = { prompt_index: number; text: string };

export type CloseCoachingResponse = {
  insights: string[];
  affirmations: string[];
  closing_note: string;
};

export function closeCoaching(
  sessionId: string,
  body: { answers: CoachingAnswer[]; duration_ms?: number },
): Promise<CloseCoachingResponse> {
  return api(`/api/coaching/${sessionId}/close`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type RateCoachingBody = {
  rating: "useful" | "not_useful";
  note?: string;
};

export function rateCoaching(
  sessionId: string,
  body: RateCoachingBody,
): Promise<{ ok: true }> {
  return api(`/api/coaching/${sessionId}/rate`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M20 — Artifact tag suggestion (AI) ────────────────────────────

export type TagKind = "topic" | "phase" | "persona" | "custom";

export type TagProposalAI = {
  tag_name: string;
  kind: TagKind;
  rationale_en: string;
  rationale_cn: string;
};

export type SuggestTagsResponse = {
  manager_action_id: string;
  proposals: TagProposalAI[];
};

export function suggestArtifactTags(artifactId: string): Promise<SuggestTagsResponse> {
  return api(`/api/artifacts/${artifactId}/suggest_tags`, { method: "POST" });
}

export type TagDecision = {
  proposal_index: number;
  action: "accept" | "edit" | "reject";
  edited_name?: string;
  edited_kind?: TagKind;
  reject_reason?: string;
};

export type ApplyTagsResponse = {
  tag_ids: string[];
  summary: { accepted: number; edited: number; rejected: number };
};

export function applyArtifactTags(
  artifactId: string,
  body: { manager_action_id: string; decisions: TagDecision[] },
): Promise<ApplyTagsResponse> {
  return api(`/api/artifacts/${artifactId}/apply_tags`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M21 — Manager Daily Brief ──────────────────────────────────────

export type BriefItem = {
  category: string;
  title: string;
  detail: string | null;
  priority: string;
};

export type DailyBriefResponse = {
  manager_action_id: string;
  headline: string | null;
  items: BriefItem[];
  summary: string | null;
  quiet: boolean;
};

export function generateDailyBrief(projectId: string): Promise<DailyBriefResponse> {
  return api(`/api/projects/${projectId}/daily_brief`, { method: "POST" });
}

export function rateDailyBrief(
  projectId: string,
  body: { manager_action_id: string; useful: boolean; note?: string },
): Promise<{ manager_action_id: string; useful: boolean }> {
  return api(`/api/projects/${projectId}/daily_brief/feedback`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ─── M21 — Manager learning insights ────────────────────────────────

export type ActionTypeStat = {
  action_type: string;
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  accept_rate: number | null;
};

export type InsightsResponse = {
  per_action_type: ActionTypeStat[];
  totals: ActionTypeStat;
  weekly_activity: { week_start: string; count: number }[];
  top_reject_reasons: { reason: string; count: number }[];
  spend: { today_usd: number; budget_usd: number; remaining_usd: number };
};

export function getProjectInsights(projectId: string): Promise<InsightsResponse> {
  return api(`/api/projects/${projectId}/insights`, { method: "GET" });
}

// ─── M21 — Open Question Engine (BET #4, Slice 1) ───────────────────

export type RunQuestionsResponse = {
  question_ids: string[];
  candidate_count: number;
  written: number;
  dropped_dup: number;
};

export function runQuestions(projectId: string): Promise<RunQuestionsResponse> {
  return api(`/api/projects/${projectId}/questions/derive`, { method: "POST" });
}

export type QuestionRespondBody = {
  action: "accept" | "edit" | "dismiss";
  edited_question?: string | null;
  edited_outreach_zh?: string | null;
  edited_outreach_en?: string | null;
  edited_owner_id?: string | null;
  reason_chip?: string | null;
  reason_free?: string | null;
  feedback_note?: string | null;
};

export function respondToQuestion(
  questionId: string,
  body: QuestionRespondBody,
): Promise<{ question_id: string; status: string }> {
  return api(`/api/questions/${questionId}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export type QuestionResolveBody = {
  answer_text: string;
  land_as: "decision" | "artifact";
  decision_reasoning?: string | null;
  decision_alternatives?: string | null;
  artifact_title?: string | null;
};

export function resolveQuestion(
  questionId: string,
  body: QuestionResolveBody,
): Promise<{
  question_id: string;
  status: string;
  landed_kind: string;
  landed_id: string;
}> {
  return api(`/api/questions/${questionId}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
