/**
 * ConfidenceBar — small horizontal bar showing AI self-reported confidence.
 *
 * Color thresholds:
 *   ≥ 81% → clay  (high)
 *   61-80% → ochre (medium)
 *   ≤ 60% → ink-3 (low / grey)
 */

import * as React from "react";

type ConfidenceBarProps = {
  /** 0..1 */
  value: number;
};

export function ConfidenceBar({ value }: ConfidenceBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const fill = pct > 80 ? "var(--clay)" : pct > 60 ? "var(--ochre)" : "var(--ink-3)";
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 6 }}
      role="meter"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="AI confidence"
    >
      <div style={{ width: 60, height: 4, background: "var(--paper-3)" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: fill }} />
      </div>
      <span
        data-tabular
        className="font-mono text-ink-2"
        style={{ fontSize: 11 }}
      >
        {pct}%
      </span>
    </div>
  );
}
