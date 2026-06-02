/**
 * Kbd — keyboard hint badge.
 *
 * Small bordered mono span. Used to advertise keyboard shortcuts inline
 * (e.g. in the proposal review's decision rail) and in the footer hint strip.
 */

import * as React from "react";

type KbdProps = {
  children: React.ReactNode;
  className?: string;
};

export function Kbd({ children, className }: KbdProps) {
  return (
    <span
      className={`font-mono text-ink-2 bg-paper border border-rule ${className ?? ""}`.trim()}
      style={{
        fontSize: 10.5,
        padding: "1px 5px",
        minWidth: 16,
        display: "inline-flex",
        justifyContent: "center",
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}
