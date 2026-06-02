/**
 * Mark — status letter mark.
 *
 * A 16×16 square with a single uppercase letter inside (mono, 10px). Border
 * inherits from `currentColor` so a parent can recolor by setting `color`.
 * Use for compact status tokens (e.g. "B" for blocked, "R" for ready).
 */

import * as React from "react";

type MarkProps = {
  letter: string;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
};

export function Mark({ letter, color, style, className }: MarkProps) {
  return (
    <span
      className={`mark ${className ?? ""}`.trim()}
      style={{ color: color ?? "var(--ink-2)", ...style }}
    >
      {letter}
    </span>
  );
}
