/**
 * Chip — bilingual selectable reason chip.
 *
 * Used for reject-reason single-select strips and any other tag-style picker.
 * Inactive state uses the global `.chip` class; active state applies `.chip.active`
 * which switches to clay-soft fill + clay border.
 */

import * as React from "react";

type ChipProps = {
  cn: string;
  en?: string;
  active?: boolean;
  onClick?: () => void;
  /** A leading mono numeric badge (1-9) for keyboard hint. */
  leading?: React.ReactNode;
  type?: "button" | "submit";
  className?: string;
};

export function Chip({ cn, en, active = false, onClick, leading, type = "button", className }: ChipProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`chip ${active ? "active" : ""} ${className ?? ""}`.trim()}
    >
      {leading != null && (
        <span
          className="font-mono text-ink-3"
          style={{ fontSize: 10, marginRight: 4 }}
        >
          {leading}
        </span>
      )}
      <span className="font-sc">{cn}</span>
      {en && (
        <span className="text-ink-3" style={{ fontSize: 11 }}>
          · {en}
        </span>
      )}
    </button>
  );
}
