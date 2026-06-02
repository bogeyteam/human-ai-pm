/**
 * Bi — bilingual span primitive.
 *
 * Renders a CN-led pair: structural CN text, optional EN gloss in lighter weight.
 * The global `.cn-en .en` CSS rule provides the typographic treatment
 * (lighter color, slight inset). The `glossSize` prop controls how small the EN
 * gloss is relative to the surrounding CN body.
 *
 * Use everywhere mixed CN + EN appears. Do not hand-roll <span>EN</span> + CN
 * pairs in components.
 */

import * as React from "react";

type BiProps = {
  cn?: string;
  en?: string;
  className?: string;
  /** EN gloss size, em-relative. Default 0.78. */
  glossSize?: number;
  weight?: number;
  children?: React.ReactNode;
};

export function Bi({ cn, en, className, glossSize = 0.78, weight, children }: BiProps) {
  return (
    <span
      className={`cn-en font-sc ${className ?? ""}`.trim()}
      style={weight ? { fontWeight: weight } : undefined}
    >
      {cn != null ? <span lang="zh">{cn}</span> : children}
      {en && (
        <span
          className="en"
          lang="en"
          style={{ fontSize: `${glossSize}em`, verticalAlign: "0.05em" }}
        >
          {en}
        </span>
      )}
    </span>
  );
}

/**
 * BiE — EN-led variant for English-primary UI labels (modals, buttons).
 * CN appears smaller, dimmer, after the EN.
 */
type BiEProps = {
  en: string;
  cn?: string;
  className?: string;
};

export function BiE({ en, cn, className }: BiEProps) {
  return (
    <span className={`cn-en ${className ?? ""}`.trim()}>
      {en}
      {cn && (
        <span
          className="font-sc text-ink-3"
          style={{
            fontSize: "0.85em",
            marginLeft: "0.4em",
            fontWeight: 400,
          }}
        >
          {cn}
        </span>
      )}
    </span>
  );
}
