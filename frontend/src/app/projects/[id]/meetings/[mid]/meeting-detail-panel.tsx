"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AIText } from "@/components/almanac/AIText";
import { Bi } from "@/components/almanac/Bi";
import { Chip } from "@/components/almanac/Chip";
import { Glyph } from "@/components/almanac/Glyph";
import { MarkdownView } from "@/components/almanac/MarkdownView";
import { Micro } from "@/components/almanac/Micro";
import {
  extractMeetingActionItems,
  generateMeetingPreBrief,
  persistMeetingActionItems,
  respondToMeetingPreBrief,
  type ActionItemDecision,
  type ActionItemProposal,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Meeting = {
  id: string;
  project_id: string;
  type: string;
  scheduled_at: string | null;
  attendees: string[];
  agenda: { markdown?: string } | null;
  notes: string | null;
  ai_pre_brief: string | null;
  ai_post_summary: string | null;
};

type Teammate = { id: string; name: string | null; email: string };

const TYPES = [
  { value: "weekly_retro", cn: "周复盘", en: "Weekly retro" },
  { value: "biweekly_planning", cn: "双周规划", en: "Biweekly planning" },
  { value: "daily_ops", cn: "日常运营", en: "Daily ops" },
  { value: "ad_hoc", cn: "临时", en: "Ad hoc" },
];

const REJECT_CHIPS = [
  { key: "already_done", cn: "已经做过", en: "Already done" },
  { key: "not_actionable", cn: "不是 actionable", en: "Not actionable" },
  { key: "duplicate", cn: "重复了", en: "Duplicate" },
  { key: "wrong_granularity", cn: "颗粒度不对", en: "Wrong granularity" },
];

type ProposalState = {
  proposal: ActionItemProposal;
  action: "accept" | "edit" | "reject";
  title: string;
  description: string;
  estimated_hours: string;
  owner_id: string;
  reject_chip: string | null;
  reject_free: string;
};

export function MeetingDetailPanel({
  projectId: _projectId,
  meeting: initial,
  teammates,
}: {
  projectId: string;
  meeting: Meeting;
  teammates: Teammate[];
}) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting>(initial);
  const [editingMeta, setEditingMeta] = useState(false);

  // Meta-editing local state
  const [metaType, setMetaType] = useState(meeting.type);
  const [metaScheduled, setMetaScheduled] = useState(
    meeting.scheduled_at ? toLocalDateTime(meeting.scheduled_at) : "",
  );
  const [metaAttendees, setMetaAttendees] = useState<string[]>(meeting.attendees);

  // Pre-brief state
  const [preBriefDraft, setPreBriefDraft] = useState<string | null>(
    meeting.ai_pre_brief,
  );
  const [, setPreBriefManagerActionId] = useState<string | null>(null);
  const [preBriefStatus, setPreBriefStatus] = useState<"idle" | "generating" | "ready" | "editing" | "saving" | "saved">(
    meeting.agenda?.markdown ? "saved" : meeting.ai_pre_brief ? "ready" : "idle",
  );
  const [preBriefEdited, setPreBriefEdited] = useState<string>(
    meeting.agenda?.markdown ?? meeting.ai_pre_brief ?? "",
  );
  const [preBriefReason, setPreBriefReason] = useState("");
  const [preBriefError, setPreBriefError] = useState<string | null>(null);

  // Notes state — autosave on blur.
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [notesSaving, setNotesSaving] = useState(false);

  // Action-item extraction state
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [postSummaryActionId, setPostSummaryActionId] = useState<string | null>(null);
  const [postSummaryText, setPostSummaryText] = useState<string | null>(null);
  const [persistDone, setPersistDone] = useState<string | null>(null);

  async function saveMeta() {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase
      .from("meetings")
      .update({
        type: metaType,
        scheduled_at: metaScheduled ? new Date(metaScheduled).toISOString() : null,
        attendees: metaAttendees,
      })
      .eq("id", meeting.id)
      .select(
        "id, project_id, type, scheduled_at, attendees, agenda, notes, ai_pre_brief, ai_post_summary",
      )
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    setMeeting(data as Meeting);
    setEditingMeta(false);
    router.refresh();
  }

  async function saveNotes() {
    if (notes === (meeting.notes ?? "")) return;
    setNotesSaving(true);
    const supabase = supabaseBrowser();
    const { error } = await supabase
      .from("meetings")
      .update({ notes: notes || null })
      .eq("id", meeting.id);
    setNotesSaving(false);
    if (error) {
      alert(`Note save failed: ${error.message}`);
      return;
    }
    setMeeting((m) => ({ ...m, notes: notes || null }));
  }

  async function onGeneratePreBrief() {
    setPreBriefError(null);
    setPreBriefStatus("generating");
    try {
      const res = await generateMeetingPreBrief(meeting.id);
      setPreBriefDraft(res.markdown);
      setPreBriefEdited(res.markdown);
      setPreBriefManagerActionId(res.manager_action_id);
      setPreBriefStatus("ready");
    } catch (err) {
      setPreBriefError(extractError(err));
      setPreBriefStatus(meeting.agenda?.markdown ? "saved" : "idle");
    }
  }

  async function onPreBriefVerdict(verdict: "accept" | "edit" | "reject") {
    setPreBriefError(null);
    if (verdict === "reject" && !preBriefReason.trim()) {
      setPreBriefError("Reject requires a reason — what was wrong with this brief?");
      return;
    }
    setPreBriefStatus("saving");
    try {
      const res = await respondToMeetingPreBrief(meeting.id, {
        action: verdict,
        edited_markdown: verdict === "edit" ? preBriefEdited : null,
        reason: verdict === "reject" ? preBriefReason : null,
      });
      if (res.final_markdown !== null) {
        setMeeting((m) => ({
          ...m,
          agenda: { ...(m.agenda ?? {}), markdown: res.final_markdown ?? "" },
        }));
        setPreBriefStatus("saved");
      } else {
        // Rejected. Go back to idle so user can regenerate with feedback baked in.
        setPreBriefStatus("idle");
        setPreBriefReason("");
        setPreBriefDraft(null);
      }
      router.refresh();
    } catch (err) {
      setPreBriefError(extractError(err));
      setPreBriefStatus("ready");
    }
  }

  async function onExtract() {
    setExtractionError(null);
    setExtracting(true);
    setPersistDone(null);
    try {
      const res = await extractMeetingActionItems(meeting.id);
      setPostSummaryActionId(res.manager_action_id);
      setPostSummaryText(res.summary);
      setProposals(
        res.action_items.map((p) => ({
          proposal: p,
          action: "accept",
          title: p.title,
          description: p.description ?? "",
          estimated_hours: p.estimated_hours?.toString() ?? "",
          owner_id:
            teammates.find((t) => t.email === p.suggested_owner_email)?.id ?? "",
          reject_chip: null,
          reject_free: "",
        })),
      );
    } catch (err) {
      setExtractionError(extractError(err));
    } finally {
      setExtracting(false);
    }
  }

  async function onPersist() {
    if (!postSummaryActionId) return;
    setExtractionError(null);
    const missing = proposals.find(
      (s) => s.action === "reject" && !s.reject_chip && !s.reject_free.trim(),
    );
    if (missing) {
      setExtractionError(
        `Item "${missing.proposal.title}" rejected without a reason — pick a chip or type one.`,
      );
      return;
    }
    try {
      const decisions: ActionItemDecision[] = proposals.map((s) => {
        if (s.action === "reject") {
          return {
            index: s.proposal.index,
            action: "reject",
            reject_reason_chip: s.reject_chip,
            reject_reason_free: s.reject_free.trim() || null,
          };
        }
        if (s.action === "edit") {
          return {
            index: s.proposal.index,
            action: "edit",
            title: s.title,
            description: s.description || null,
            estimated_hours: s.estimated_hours ? Number(s.estimated_hours) : null,
            suggested_owner_id: s.owner_id || null,
          };
        }
        return {
          index: s.proposal.index,
          action: "accept",
          suggested_owner_id: s.owner_id || null,
        };
      });
      const res = await persistMeetingActionItems(meeting.id, {
        manager_action_id: postSummaryActionId,
        decisions,
      });
      const tally = `${res.summary.accepted} accepted, ${res.summary.edited} edited, ${res.summary.rejected} rejected`;
      setPersistDone(tally);
      setProposals([]);
      setMeeting((m) => ({ ...m, ai_post_summary: tally }));
      router.refresh();
    } catch (err) {
      setExtractionError(extractError(err));
    }
  }

  function setProposal(idx: number, patch: Partial<ProposalState>) {
    setProposals((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  const acceptedAgenda = meeting.agenda?.markdown ?? null;
  const meetingType = TYPES.find((t) => t.value === meeting.type);

  return (
    <div className="space-y-6">
      {/* ─── Header / meta ────────────────────────────────────────── */}
      <section className="border border-rule bg-paper p-4">
        {editingMeta ? (
          <div className="space-y-3">
            <label className="block">
              <Micro style={{ marginBottom: 6 }}>
                <Bi cn="类型" en="Type" glossSize={0.78} />
              </Micro>
              <select
                value={metaType}
                onChange={(e) => setMetaType(e.target.value)}
                className="w-full border border-rule bg-paper px-2 py-1 text-sm text-ink outline-none transition focus:border-ink"
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
                <Bi cn="时间" en="Scheduled" glossSize={0.78} />
              </Micro>
              <input
                type="datetime-local"
                value={metaScheduled}
                onChange={(e) => setMetaScheduled(e.target.value)}
                className="w-full border border-rule bg-paper px-2 py-1 font-mono text-sm text-ink outline-none transition focus:border-ink"
              />
            </label>
            <div>
              <Micro style={{ marginBottom: 6 }}>
                <Bi cn="参会人" en="Attendees" glossSize={0.78} />
              </Micro>
              <div className="space-y-1">
                {teammates.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 text-sm text-ink"
                  >
                    <input
                      type="checkbox"
                      checked={metaAttendees.includes(t.id)}
                      onChange={(e) =>
                        setMetaAttendees((prev) =>
                          e.target.checked
                            ? [...prev, t.id]
                            : prev.filter((x) => x !== t.id),
                        )
                      }
                      className="h-3.5 w-3.5 accent-ink"
                    />
                    <span>{t.name || t.email}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-rule pt-3">
              <button
                onClick={() => setEditingMeta(false)}
                className="border border-rule bg-paper px-3 py-1 text-xs text-ink-2 transition hover:bg-paper-3 hover:text-ink"
              >
                <Bi cn="取消" en="Cancel" glossSize={0.78} />
              </button>
              <button
                onClick={saveMeta}
                className="bg-ink px-3 py-1 text-xs font-medium text-paper transition hover:bg-clay-deep"
              >
                <Bi cn="保存" en="Save" glossSize={0.78} />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-baseline justify-between gap-4">
            <div className="min-w-0">
              <Micro style={{ marginBottom: 4 }}>
                <Bi
                  cn={meetingType?.cn ?? meeting.type}
                  en={meetingType?.en ?? meeting.type}
                  glossSize={0.85}
                />
              </Micro>
              <h1 className="font-sc text-xl font-medium leading-tight text-ink">
                {meeting.scheduled_at
                  ? new Date(meeting.scheduled_at).toLocaleString()
                  : "Unscheduled"}
              </h1>
              <p className="mt-1 font-mono text-[11px] text-ink-3">
                {meeting.attendees.length} attendee{meeting.attendees.length === 1 ? "" : "s"}
              </p>
            </div>
            <button
              onClick={() => setEditingMeta(true)}
              className="inline-flex shrink-0 items-center gap-1.5 border border-rule bg-paper px-3 py-1.5 text-sm text-ink-2 transition hover:border-rule-ink hover:bg-paper-3 hover:text-ink"
            >
              <Glyph name="pencil" size={11} />
              <Bi cn="编辑" en="Edit" glossSize={0.78} />
            </button>
          </div>
        )}
      </section>

      {/* ─── Pre-brief section ────────────────────────────────────── */}
      <section className="border border-rule bg-paper p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Micro>
              <Bi cn="① 会前简报" en="① Pre-brief" glossSize={0.85} />
            </Micro>
            <p className="mt-1 text-xs text-ink-3">
              <Bi
                cn="AI 基于项目状态生成议程草稿"
                en="AI drafts an agenda from current project state"
                glossSize={0.78}
              />
            </p>
          </div>
          {acceptedAgenda && preBriefStatus === "saved" && (
            <button
              onClick={() => {
                setPreBriefStatus("idle");
                setPreBriefDraft(null);
              }}
              className="text-xs text-clay-ink underline decoration-rule underline-offset-2 hover:decoration-clay-ink"
            >
              <Bi cn="重新生成" en="Regenerate" glossSize={0.78} />
            </button>
          )}
        </div>

        {preBriefError && (
          <div className="mb-3 border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
            {preBriefError}
          </div>
        )}

        {preBriefStatus === "idle" && (
          <button
            onClick={onGeneratePreBrief}
            className="inline-flex items-center gap-2 bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep"
          >
            <Glyph name="sparkle" size={12} />
            <Bi cn="生成会前简报" en="Generate pre-brief" glossSize={0.78} />
          </button>
        )}

        {preBriefStatus === "generating" && (
          <p className="text-sm italic text-ink-3">
            <Bi
              cn="正在根据项目状态生成议程…"
              en="Generating agenda from project state…"
              glossSize={0.78}
            />
          </p>
        )}

        {(preBriefStatus === "ready" ||
          preBriefStatus === "editing" ||
          preBriefStatus === "saving") && (
          <div className="space-y-3">
            {preBriefStatus === "editing" ? (
              <textarea
                rows={20}
                value={preBriefEdited}
                onChange={(e) => setPreBriefEdited(e.target.value)}
                className="w-full border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink outline-none transition focus:border-ink"
              />
            ) : preBriefDraft ? (
              <div className="border border-rule bg-paper-2 px-4 py-3">
                <MarkdownView source={preBriefDraft} />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <ActionBtn
                cn="接受"
                en="Accept"
                active={false}
                tone="sage"
                onClick={() => onPreBriefVerdict("accept")}
                disabled={preBriefStatus === "saving"}
              />
              <ActionBtn
                cn={preBriefStatus === "editing" ? "停止编辑" : "编辑"}
                en={preBriefStatus === "editing" ? "Stop editing" : "Edit"}
                active={preBriefStatus === "editing"}
                tone="ochre"
                onClick={() =>
                  setPreBriefStatus(preBriefStatus === "editing" ? "ready" : "editing")
                }
                disabled={preBriefStatus === "saving"}
              />
              {preBriefStatus === "editing" && (
                <button
                  onClick={() => onPreBriefVerdict("edit")}
                  disabled={(preBriefStatus as string) !== "editing"}
                  className="border border-ochre bg-ochre-soft px-3 py-1 text-xs font-medium text-ochre-ink transition hover:bg-ochre/30"
                >
                  <Bi cn="保存编辑" en="Save edits" glossSize={0.78} />
                </button>
              )}
              <input
                type="text"
                value={preBriefReason}
                onChange={(e) => setPreBriefReason(e.target.value)}
                placeholder="拒绝原因（帮助 AI 下次改进）· reason for rejecting"
                className="flex-1 border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none transition focus:border-ink"
              />
              <ActionBtn
                cn="拒绝"
                en="Reject"
                active={false}
                tone="rust"
                onClick={() => onPreBriefVerdict("reject")}
                disabled={preBriefStatus === "saving"}
              />
            </div>
          </div>
        )}

        {preBriefStatus === "saved" && acceptedAgenda && (
          <div className="border border-sage-soft bg-sage-soft/40 px-4 py-3">
            <MarkdownView source={acceptedAgenda} />
          </div>
        )}
      </section>

      {/* ─── Notes section ────────────────────────────────────────── */}
      <section className="border border-rule bg-paper p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Micro>
              <Bi cn="② 会议笔记" en="② Notes" glossSize={0.85} />
            </Micro>
            <p className="mt-1 text-xs text-ink-3">
              <Bi
                cn="开会过程中或之后记下来的内容"
                en="What was said during or after the meeting"
                glossSize={0.78}
              />
            </p>
          </div>
          {notesSaving && (
            <span className="font-mono text-[11px] text-ink-4">saving…</span>
          )}
        </div>
        <textarea
          rows={12}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="开会过程中或之后记下来的内容。AI 会从这里提取 action items..."
          className="w-full border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink outline-none transition focus:border-ink"
        />
        <p className="mt-1 font-mono text-[11px] text-ink-4">
          <Bi
            cn="离开输入框时自动保存"
            en="Autosaves on blur (click outside the box)"
            glossSize={0.78}
          />
        </p>
      </section>

      {/* ─── Post-summary section ─────────────────────────────────── */}
      <section className="border border-rule bg-paper p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <Micro>
              <Bi cn="③ 会后任务提取" en="③ Action items" glossSize={0.85} />
            </Micro>
            <p className="mt-1 text-xs text-ink-3">
              <Bi
                cn="AI 从笔记中抽出可执行任务"
                en="AI extracts actionable tasks from your notes"
                glossSize={0.78}
              />
            </p>
          </div>
          {meeting.ai_post_summary && (
            <span className="font-mono text-[11px] text-ink-3">
              {meeting.ai_post_summary}
            </span>
          )}
        </div>

        {extractionError && (
          <div className="mb-3 border border-rust-soft bg-rust-soft/40 px-3 py-2 text-sm text-rust-ink">
            {extractionError}
          </div>
        )}

        {persistDone && (
          <div className="mb-3 border border-sage-soft bg-sage-soft/40 px-3 py-2 text-sm text-sage-ink">
            <Glyph name="check" size={12} /> {persistDone}.{" "}
            <Bi
              cn="打开「任务」标签查看新条目"
              en="Open the Tasks tab to see new items"
              glossSize={0.78}
            />
          </div>
        )}

        {proposals.length === 0 && (
          <button
            onClick={onExtract}
            disabled={extracting || !(meeting.notes ?? "").trim()}
            className="inline-flex items-center gap-2 bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
          >
            <Glyph name="sparkle" size={12} />
            {extracting ? (
              <Bi cn="正在提取…" en="Extracting…" glossSize={0.78} />
            ) : (
              <Bi
                cn="从笔记提取 action items"
                en="Extract action items from notes"
                glossSize={0.78}
              />
            )}
          </button>
        )}

        {!proposals.length && !meeting.notes?.trim() && (
          <p className="mt-2 text-xs italic text-ink-3">
            <Bi
              cn="先在上面写一些笔记。AI 只会提取笔记里明确提到的事项。"
              en="Add some notes above first. The AI only extracts items explicitly mentioned in the notes."
              glossSize={0.78}
            />
          </p>
        )}

        {postSummaryText && proposals.length > 0 && (
          <div className="mb-3 border border-rule bg-paper-2 px-3 py-2 text-sm">
            <Micro style={{ marginBottom: 4 }}>
              <Bi cn="AI 摘要" en="AI summary" glossSize={0.78} />
            </Micro>
            <AIText as="p">{postSummaryText}</AIText>
          </div>
        )}

        {proposals.length > 0 && (
          <div className="space-y-3">
            <ul className="space-y-3">
              {proposals.map((s, i) => {
                const toneClass =
                  s.action === "reject"
                    ? "border-rust bg-rust-soft/40"
                    : s.action === "edit"
                      ? "border-ochre bg-ochre-soft/40"
                      : "border-sage bg-sage-soft/40";
                return (
                  <li key={i} className={`border p-3 ${toneClass}`}>
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="flex-1">
                        {s.action === "edit" ? (
                          <input
                            type="text"
                            value={s.title}
                            onChange={(e) => setProposal(i, { title: e.target.value })}
                            className="w-full border border-rule bg-paper px-2 py-1 font-sc text-sm font-medium text-ink outline-none focus:border-ink"
                          />
                        ) : (
                          <p className="font-sc text-sm font-medium text-ink">
                            {s.proposal.title}
                          </p>
                        )}
                        <p className="mt-0.5 font-mono text-[11px] text-ink-3">
                          {s.proposal.estimated_hours
                            ? `${s.proposal.estimated_hours}h`
                            : ""}
                          {s.proposal.suggested_owner_email
                            ? ` · → ${s.proposal.suggested_owner_email}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <ActionBtn
                          cn="接受"
                          en="Accept"
                          active={s.action === "accept"}
                          tone="sage"
                          onClick={() => setProposal(i, { action: "accept" })}
                        />
                        <ActionBtn
                          cn="编辑"
                          en="Edit"
                          active={s.action === "edit"}
                          tone="ochre"
                          onClick={() => setProposal(i, { action: "edit" })}
                        />
                        <ActionBtn
                          cn="拒绝"
                          en="Reject"
                          active={s.action === "reject"}
                          tone="rust"
                          onClick={() => setProposal(i, { action: "reject" })}
                        />
                      </div>
                    </div>

                    {s.action === "edit" ? (
                      <div className="space-y-2">
                        <textarea
                          value={s.description}
                          onChange={(e) =>
                            setProposal(i, { description: e.target.value })
                          }
                          rows={2}
                          placeholder="描述 · description"
                          className="w-full border border-rule bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-ink"
                        />
                        <div className="flex gap-2">
                          <input
                            type="number"
                            step="0.5"
                            value={s.estimated_hours}
                            onChange={(e) =>
                              setProposal(i, { estimated_hours: e.target.value })
                            }
                            placeholder="hours"
                            className="w-24 border border-rule bg-paper px-2 py-1 font-mono text-sm text-ink outline-none focus:border-ink"
                          />
                          <select
                            value={s.owner_id}
                            onChange={(e) =>
                              setProposal(i, { owner_id: e.target.value })
                            }
                            className="border border-rule bg-paper px-2 py-1 text-sm text-ink outline-none focus:border-ink"
                          >
                            <option value="">— Unassigned —</option>
                            {teammates.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name || t.email}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : s.proposal.description ? (
                      <p className="text-sm text-ink-2">{s.proposal.description}</p>
                    ) : null}

                    {s.proposal.reasoning && (
                      <div className="mt-2">
                        <Micro style={{ marginBottom: 2 }}>
                          <Bi cn="AI 理由" en="AI reasoning" glossSize={0.78} />
                        </Micro>
                        <AIText as="p" className="text-xs text-ink-2">
                          {s.proposal.reasoning}
                        </AIText>
                      </div>
                    )}

                    {s.action === "reject" && (
                      <div className="mt-3 space-y-2">
                        <div className="flex flex-wrap gap-1">
                          {REJECT_CHIPS.map((c) => (
                            <Chip
                              key={c.key}
                              cn={c.cn}
                              en={c.en}
                              active={s.reject_chip === c.key}
                              onClick={() =>
                                setProposal(i, {
                                  reject_chip: s.reject_chip === c.key ? null : c.key,
                                })
                              }
                            />
                          ))}
                        </div>
                        <input
                          type="text"
                          value={s.reject_free}
                          onChange={(e) =>
                            setProposal(i, { reject_free: e.target.value })
                          }
                          placeholder="或自己写一条理由 · or type a reason"
                          className="w-full border border-rule bg-paper px-2 py-1 text-xs text-ink outline-none focus:border-ink"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-between border-t border-rule pt-3">
              <p className="font-mono text-[11px] text-ink-3">
                {proposals.filter((s) => s.action === "accept").length} accept ·{" "}
                {proposals.filter((s) => s.action === "edit").length} edit ·{" "}
                {proposals.filter((s) => s.action === "reject").length} reject
              </p>
              <button
                onClick={onPersist}
                disabled={proposals.length === 0}
                className="bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
              >
                <Bi cn="生成任务" en="Apply → create tasks" glossSize={0.78} />
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ActionBtn({
  cn,
  en,
  active,
  onClick,
  tone,
  disabled,
}: {
  cn: string;
  en: string;
  active: boolean;
  onClick: () => void;
  tone: "sage" | "ochre" | "rust";
  disabled?: boolean;
}) {
  const activeCls =
    tone === "sage"
      ? "bg-sage-soft text-sage-ink border-sage"
      : tone === "ochre"
        ? "bg-ochre-soft text-ochre-ink border-ochre"
        : "bg-rust-soft text-rust-ink border-rust";
  const inactiveCls = "bg-paper text-ink-2 border-rule hover:bg-paper-3 hover:text-ink";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border px-2 py-1 text-xs font-medium transition disabled:opacity-40 ${
        active ? activeCls : inactiveCls
      }`}
    >
      <Bi cn={cn} en={en} glossSize={0.78} />
    </button>
  );
}

function toLocalDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
