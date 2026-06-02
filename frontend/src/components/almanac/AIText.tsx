/**
 * AIText — the AI's typographic voice.
 *
 * Wraps prose in `.ai-voice` (italic IBM Plex Serif). Use anywhere the AI
 * is speaking in first-person: rationales, suggestion explanations, post-meeting
 * summaries. Never use for user-authored content.
 */

import * as React from "react";

type AITextProps = {
  children: React.ReactNode;
  as?: "span" | "div" | "p";
  className?: string;
  style?: React.CSSProperties;
};

export function AIText({ children, as = "span", className, style }: AITextProps) {
  const Tag = as;
  return (
    <Tag className={`ai-voice ${className ?? ""}`.trim()} style={style}>
      {children}
    </Tag>
  );
}
