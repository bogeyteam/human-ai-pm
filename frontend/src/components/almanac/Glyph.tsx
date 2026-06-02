/**
 * Glyph — typographic icons drawn from monospace.
 *
 * We avoid SVG icon libraries (lucide etc.) in favor of small monospace
 * glyphs. They share the type rhythm of the rest of the UI and don't
 * carry the "tech product" tell of a default icon set.
 */

import * as React from "react";

const GLYPH_MAP = {
  arrow: "→",
  larrow: "←",
  up: "↑",
  down: "↓",
  check: "✓",
  cross: "✕",
  pencil: "✎",
  bullet: "•",
  diamond: "◆",
  square: "■",
  circle: "●",
  ring: "○",
  half: "◐",
  plus: "+",
  minus: "−",
  dots: "⋯",
  star: "✦",
  asterisk: "✱",
  sparkle: "❋",
  rule: "—",
  ai: "❋",
  open: "❒",
  book: "❐",
  flag: "⚑",
  chevron: "›",
  chevdown: "⌄",
  chevup: "⌃",
  return: "↵",
} as const;

export type GlyphName = keyof typeof GLYPH_MAP;

type GlyphProps = {
  name: GlyphName | string;
  size?: number;
  color?: string;
  style?: React.CSSProperties;
  className?: string;
};

export function Glyph({ name, size = 14, color, style, className }: GlyphProps) {
  const glyph = (GLYPH_MAP as Record<string, string>)[name] ?? name;
  return (
    <span
      aria-hidden="true"
      className={`font-mono ${className ?? ""}`.trim()}
      style={{
        fontSize: size,
        lineHeight: 1,
        color: color || "currentColor",
        display: "inline-block",
        ...style,
      }}
    >
      {glyph}
    </span>
  );
}
