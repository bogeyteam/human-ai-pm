/**
 * DecisionMark — small letter mark shown below the proposal index when
 * a decision has been made. Mirrors the variant palette from DecisionButton.
 */

import * as React from "react";
import type { Decision } from "./types";

type DecisionMarkProps = {
  decision: Exclude<Decision, null>;
};

const MAP: Record<Exclude<Decision, null>, { letter: string; color: string; bg: string }> = {
  accept: { letter: "A", color: "var(--sage-ink)", bg: "var(--sage-soft)" },
  edit: { letter: "E", color: "var(--ochre-ink)", bg: "var(--ochre-soft)" },
  reject: { letter: "R", color: "var(--rust-ink)", bg: "var(--rust-soft)" },
  skip: { letter: "—", color: "var(--ink-3)", bg: "var(--paper-3)" },
};

export function DecisionMark({ decision }: DecisionMarkProps) {
  const m = MAP[decision];
  return (
    <div
      className="font-mono"
      style={{
        width: 22,
        height: 22,
        background: m.bg,
        color: m.color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 600,
        border: `1px solid ${m.color}`,
      }}
      aria-label={`decision-${decision}`}
    >
      {m.letter}
    </div>
  );
}
