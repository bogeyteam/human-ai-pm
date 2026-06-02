/**
 * ProposalCard — one row in the proposal stack.
 *
 * 3-column grid:
 *   - 44px index column (AI iris-bordered "01" + decision mark below)
 *   - flex main body (kind label, confidence, body, AI rationale, edit/reject UI)
 *   - 220px decision rail (Accept/Edit/Reject + Skip)
 *
 * Reject opens an inline REJECT_REASONS chip strip below the rationale.
 * Edit opens an inline textarea pre-filled with the proposal CN title/content.
 *
 * The card is focusable as a region so keyboard handlers in the parent
 * can scroll it into view and apply per-card shortcuts.
 */

import * as React from "react";
import { Bi } from "../Bi";
import { Chip } from "../Chip";
import { Glyph } from "../Glyph";
import { Micro } from "../Micro";
import { ConfidenceBar } from "./ConfidenceBar";
import { DecisionButton } from "./DecisionButton";
import { DecisionMark } from "./DecisionMark";
import { KindLabel } from "./KindLabel";
import { ProposalBody } from "./ProposalBody";
import type { Decision, Proposal, RejectReason } from "./types";

type ProposalCardProps = {
  p: Proposal;
  idx: number;
  total: number;
  decision: Exclude<Decision, null> | undefined;
  reasonId: string | null | undefined;
  editedText: string | null | undefined;
  focused: boolean;
  rejectReasons: RejectReason[];
  onDecide: (d: Exclude<Decision, null>) => void;
  onReason: (reasonId: string) => void;
  onEditText: (text: string) => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
};

export function ProposalCard({
  p,
  idx,
  total: _total,
  decision,
  reasonId,
  editedText,
  focused,
  rejectReasons,
  onDecide,
  onReason,
  onEditText,
  onFocus,
  registerRef,
}: ProposalCardProps) {
  const isReject = decision === "reject";
  const isAccept = decision === "accept";
  const isEdit = decision === "edit";

  // Default edit-text content: prefer titleCn, then proposalCn, then a sensible fallback.
  const initialEditText = React.useMemo(() => {
    if (editedText != null) return editedText;
    return (
      (p.after.titleCn as string | undefined) ??
      (p.after.proposalCn as string | undefined) ??
      (p.after.titleEn as string | undefined) ??
      ""
    );
  }, [editedText, p.after]);

  return (
    <article
      ref={(el) => registerRef(el)}
      tabIndex={-1}
      onFocus={onFocus}
      onClick={onFocus}
      aria-current={focused ? "true" : undefined}
      data-proposal-id={p.id}
      className="bg-paper"
      style={{
        borderTop: "1px solid var(--rule)",
        borderLeft: focused ? "2px solid var(--ai-rule)" : "2px solid transparent",
        padding: "22px 28px 22px 0",
        display: "grid",
        gridTemplateColumns: "44px 1fr 220px",
        gap: 22,
        position: "relative",
        opacity: decision === "skip" ? 0.45 : 1,
        transition: "opacity 220ms cubic-bezier(0.2, 0, 0, 1)",
        outline: "none",
      }}
    >
      {/* Index + AI mark column */}
      <div style={{ paddingTop: 4, paddingLeft: 20 }}>
        <div
          className="font-mono"
          style={{
            width: 22,
            height: 22,
            border: "1px solid var(--ai-rule)",
            color: "var(--ai)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 500,
            background: "var(--ai-soft)",
            marginBottom: 8,
          }}
        >
          {String(idx + 1).padStart(2, "0")}
        </div>
        {decision && <DecisionMark decision={decision} />}
      </div>

      {/* Main body */}
      <div style={{ minWidth: 0 }}>
        {/* Header strip */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <KindLabel kind={p.kind} />
          <span
            className="font-mono text-ink-3"
            style={{ fontSize: 11 }}
          >
            {p.target.id}
          </span>
          <Glyph name="rule" size={11} color="var(--ink-4)" />
          <span className="text-ink-3" style={{ fontSize: 12 }}>
            <Bi cn="置信度" en="confidence" glossSize={0.78} />
          </span>
          <ConfidenceBar value={p.confidence} />
        </div>

        {/* Diff or new content */}
        <ProposalBody p={p} />

        {/* AI rationale — italic serif (the AI voice) */}
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px dashed var(--rule)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 6,
            }}
          >
            <Glyph name="ai" size={10} color="var(--ai)" />
            <Micro color="var(--ai)">Rationale · 理由</Micro>
          </div>
          <div className="ai-voice" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            {p.rationaleAi}
          </div>
          <div
            className="ai-voice text-ink-2"
            style={{ fontSize: 13, lineHeight: 1.7, marginTop: 2 }}
          >
            {p.rationaleAiCn}
          </div>
        </div>

        {/* Reject reason chip strip */}
        {isReject && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--rust-soft)",
            }}
            data-reason-strip
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <Glyph name="cross" size={11} color="var(--rust)" />
              <Micro color="var(--rust)">
                Reason · 拒绝原因 (fed into next call)
              </Micro>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {rejectReasons.map((r, i) => (
                <Chip
                  key={r.id}
                  cn={r.cn}
                  en={r.en}
                  active={reasonId === r.id}
                  onClick={() => onReason(r.id)}
                  leading={focused && i < 9 ? i + 1 : undefined}
                />
              ))}
            </div>
          </div>
        )}

        {/* Edit inline state */}
        {isEdit && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--ochre-soft)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <Glyph name="pencil" size={11} color="var(--ochre-ink)" />
              <Micro color="var(--ochre-ink)">Edit before accepting · 编辑后接受</Micro>
            </div>
            <textarea
              value={initialEditText}
              onChange={(e) => onEditText(e.target.value)}
              className="font-sc"
              style={{
                width: "100%",
                minHeight: 64,
                fontSize: 14,
                lineHeight: 1.55,
                padding: 10,
                border: "1px solid var(--ochre)",
                background: "var(--paper)",
                color: "var(--ink)",
                resize: "vertical",
                outline: "none",
              }}
            />
          </div>
        )}
      </div>

      {/* Decision rail */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          paddingRight: 4,
        }}
      >
        <DecisionButton
          variant="accept"
          active={isAccept}
          onClick={() => onDecide("accept")}
          label={<Bi cn="接受" en="Accept" glossSize={0.72} />}
          kbd="A"
        />
        <DecisionButton
          variant="edit"
          active={isEdit}
          onClick={() => onDecide("edit")}
          label={<Bi cn="编辑" en="Edit" glossSize={0.72} />}
          kbd="E"
        />
        <DecisionButton
          variant="reject"
          active={isReject}
          onClick={() => onDecide("reject")}
          label={<Bi cn="拒绝" en="Reject" glossSize={0.72} />}
          kbd="R"
        />
        <button
          type="button"
          onClick={() => onDecide("skip")}
          className="font-sans"
          style={{
            background: "transparent",
            border: "1px solid var(--rule)",
            color: "var(--ink-3)",
            padding: "8px 12px",
            fontSize: 12,
            cursor: "pointer",
            marginTop: 6,
          }}
          aria-pressed={decision === "skip"}
        >
          <Bi cn="跳过" en="Skip" glossSize={0.72} />
          <span
            className="font-mono text-ink-4"
            style={{ marginLeft: 8, fontSize: 10 }}
          >
            S
          </span>
        </button>
      </div>
    </article>
  );
}
