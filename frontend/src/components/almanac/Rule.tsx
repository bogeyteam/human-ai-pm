/**
 * Rule — hairline horizontal or vertical divider.
 *
 * Uses the global `.rule` / `.rule-ink` classes for horizontal, inline style
 * for vertical (so vertical stretches to flex parent). Pass `ink` for the
 * darker `--rule-ink` weight (used for hero divider above titles).
 */

import * as React from "react";

type RuleProps = {
  ink?: boolean;
  vertical?: boolean;
  style?: React.CSSProperties;
  className?: string;
};

export function Rule({ ink = false, vertical = false, style, className }: RuleProps) {
  if (vertical) {
    return (
      <div
        className={className}
        style={{
          width: 1,
          alignSelf: "stretch",
          background: ink ? "var(--rule-ink)" : "var(--rule)",
          ...style,
        }}
      />
    );
  }
  return (
    <div
      className={`${ink ? "rule-ink" : "rule"} ${className ?? ""}`.trim()}
      style={style}
    />
  );
}
