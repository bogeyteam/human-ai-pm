/**
 * DecisionButton — accept / edit / reject decision-rail button.
 *
 * Visual: bordered button, left = glyph + bilingual label, right = mono kbd hint.
 * Active states use the variant's soft+ink semantic pairs:
 *   accept → sage,  edit → ochre,  reject → rust.
 * Inactive uses rule-ink border + plain ink text.
 */

import * as React from "react";
import { Glyph } from "../Glyph";

type Variant = "accept" | "edit" | "reject";

type DecisionButtonProps = {
  variant: Variant;
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  kbd: string;
};

const PALETTE: Record<Variant, { border: string; bg: string; fg: string; glyph: "check" | "pencil" | "cross" }> = {
  accept: { border: "var(--sage)", bg: "var(--sage-soft)", fg: "var(--sage-ink)", glyph: "check" },
  edit: { border: "var(--ochre)", bg: "var(--ochre-soft)", fg: "var(--ochre-ink)", glyph: "pencil" },
  reject: { border: "var(--rust)", bg: "var(--rust-soft)", fg: "var(--rust-ink)", glyph: "cross" },
};

export function DecisionButton({ variant, active, onClick, label, kbd }: DecisionButtonProps) {
  const palette = PALETTE[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="font-sans transition-all"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "10px 12px",
        fontSize: 13,
        fontWeight: 500,
        background: active ? palette.bg : "var(--paper)",
        border: `1px solid ${active ? palette.border : "var(--rule-ink)"}`,
        color: active ? palette.fg : "var(--ink)",
        cursor: "pointer",
        transitionDuration: "120ms",
        transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Glyph
          name={palette.glyph}
          size={11}
          color={active ? palette.fg : "var(--ink-2)"}
        />
        {label}
      </span>
      <span
        className="font-mono"
        style={{ fontSize: 10.5, color: active ? palette.fg : "var(--ink-4)" }}
      >
        {kbd}
      </span>
    </button>
  );
}
