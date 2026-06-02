/**
 * Tally / Tallies — count displays for ProposalReview.
 *
 *   <Tally>     compact: big numerator + A/E/R color blocks (header).
 *   <Tallies>   wide:    full Accept · Edit · Reject · Skip · Pending line (footer).
 *
 * Split out to keep `ProposalReview/index.tsx` under its LOC budget.
 */

import * as React from "react";
import { Bi } from "../Bi";
import { Glyph } from "../Glyph";

export type Counts = {
  accept: number;
  edit: number;
  reject: number;
  skip: number;
  pending: number;
};

type TallyProps = {
  counts: Counts;
  total: number;
};

export function Tally({ counts, total }: TallyProps) {
  const decided = counts.accept + counts.edit + counts.reject;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <span
          data-tabular
          className="font-mono text-ink"
          style={{ fontSize: 22, fontWeight: 500 }}
        >
          {decided}
        </span>
        <span className="font-mono text-ink-3" style={{ fontSize: 14 }}>
          / {total}
        </span>
      </div>
      <div style={{ display: "flex", gap: 1 }}>
        {[
          { c: counts.accept, color: "var(--sage)", letter: "A" },
          { c: counts.edit, color: "var(--ochre)", letter: "E" },
          { c: counts.reject, color: "var(--rust)", letter: "R" },
        ].map((g) =>
          g.c > 0 ? (
            <div
              key={g.letter}
              className="font-mono"
              style={{
                minWidth: 28,
                padding: "3px 6px",
                background: g.color,
                color: "var(--paper)",
                fontSize: 11,
                fontWeight: 500,
                textAlign: "center",
              }}
            >
              {g.letter} {g.c}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

export function Tallies({ counts }: { counts: Counts }) {
  const parts: Array<{ key: string; cn: string; en: string; n: number; color?: string }> = [
    { key: "accept", cn: "接受", en: "Accept", n: counts.accept, color: "var(--sage-ink)" },
    { key: "edit", cn: "编辑", en: "Edit", n: counts.edit, color: "var(--ochre-ink)" },
    { key: "reject", cn: "拒绝", en: "Reject", n: counts.reject, color: "var(--rust-ink)" },
    { key: "skip", cn: "跳过", en: "Skip", n: counts.skip },
    { key: "pending", cn: "待定", en: "Pending", n: counts.pending },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {parts.map((p, i) => (
        <React.Fragment key={p.key}>
          {i > 0 && <Glyph name="bullet" size={6} color="var(--ink-4)" />}
          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ color: p.color ?? "var(--ink-2)" }}>
              <Bi cn={p.cn} en={p.en} glossSize={0.78} />
            </span>
            <span
              data-tabular
              className="font-mono"
              style={{
                fontSize: 12,
                color: p.n > 0 ? p.color ?? "var(--ink)" : "var(--ink-3)",
                fontWeight: p.n > 0 ? 500 : 400,
              }}
            >
              {p.n}
            </span>
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}
