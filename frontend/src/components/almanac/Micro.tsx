/**
 * Micro — mono uppercase caps label.
 *
 * Used for section labels, timestamps, status keys. The global `.micro`
 * CSS rule sets it to IBM Plex Mono, 10.5px, uppercase, 0.08em letter-spacing.
 * Pass `color` to override; default reads from `--ink-3`.
 */

import * as React from "react";

type MicroProps = {
  children: React.ReactNode;
  style?: React.CSSProperties;
  color?: string;
  className?: string;
};

export function Micro({ children, style, color, className }: MicroProps) {
  return (
    <div
      className={`micro ${className ?? ""}`.trim()}
      style={{ color, ...style }}
    >
      {children}
    </div>
  );
}
