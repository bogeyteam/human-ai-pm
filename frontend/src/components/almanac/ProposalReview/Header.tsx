/**
 * ReviewHeader — top header strip of the ProposalReview modal.
 *
 * Renders the AI-prefixed kicker, the bilingual source title, the
 * generated-time / model metadata, the compact <Tally>, and the close button.
 * Pure presentation — owns no state.
 */

import * as React from "react";
import { Bi } from "../Bi";
import { Glyph } from "../Glyph";
import { Micro } from "../Micro";
import { Tally, type Counts } from "./Tally";

type ReviewHeaderProps = {
  titleCn: string;
  titleEn: string;
  total: number;
  counts: Counts;
  onCancel?: () => void;
};

export function ReviewHeader({ titleCn, titleEn, total, counts, onCancel }: ReviewHeaderProps) {
  return (
    <header
      style={{
        padding: "22px 32px 18px",
        borderBottom: "1px solid var(--rule-ink)",
        display: "flex",
        alignItems: "flex-end",
        gap: 24,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Glyph name="ai" size={13} color="var(--ai)" />
          <Micro color="var(--ai)">AI Proposal Review · AI 建议复核</Micro>
        </div>
        <div
          style={{
            fontSize: 26,
            fontWeight: 500,
            letterSpacing: "-0.012em",
            lineHeight: 1.2,
          }}
        >
          <span className="font-sc">{titleCn}</span>
          <span
            className="font-sans text-ink-2"
            style={{ fontWeight: 400, marginLeft: 12, fontSize: 20 }}
          >
            {titleEn}
          </span>
        </div>
        <div
          className="text-ink-3"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginTop: 8,
            fontSize: 12.5,
            flexWrap: "wrap",
          }}
        >
          <span data-tabular>
            <span className="font-mono text-ink-2">{total}</span> proposals
          </span>
          <Glyph name="bullet" size={6} color="var(--ink-4)" />
          <span>
            <Bi cn="模型" en="model" glossSize={0.78} />:{" "}
            <span className="font-mono text-ink-2">haiku-4-5</span>
          </span>
        </div>
      </div>

      <Tally counts={counts} total={total} />

      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--ink-2)",
            padding: 6,
          }}
        >
          <Glyph name="cross" size={16} />
        </button>
      )}
    </header>
  );
}
