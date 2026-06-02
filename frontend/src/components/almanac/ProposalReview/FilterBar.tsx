/**
 * FilterBar — the four filter pills (all / accept / edit / reject) +
 * keyboard-shortcut hint strip on the right.
 *
 * Pure presentation. The selected filter is owned by the parent.
 */

import * as React from "react";
import { Bi } from "../Bi";
import { Kbd } from "../Kbd";
import type { Counts } from "./Tally";

export type FilterKey = "all" | "accept" | "edit" | "reject";

type FilterBarProps = {
  filter: FilterKey;
  setFilter: (f: FilterKey) => void;
  counts: Counts;
  total: number;
};

export function FilterBar({ filter, setFilter, counts, total }: FilterBarProps) {
  const items: Array<{ k: FilterKey; cn: string; en: string; n: number; color?: string }> = [
    { k: "all", cn: "全部", en: "all", n: total },
    { k: "accept", cn: "接受", en: "accept", n: counts.accept, color: "var(--sage-ink)" },
    { k: "edit", cn: "编辑", en: "edit", n: counts.edit, color: "var(--ochre-ink)" },
    { k: "reject", cn: "拒绝", en: "reject", n: counts.reject, color: "var(--rust-ink)" },
  ];
  return (
    <div
      className="bg-paper-2"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "10px 32px",
        borderBottom: "1px solid var(--rule)",
        flexWrap: "wrap",
      }}
    >
      {items.map((f) => (
        <button
          key={f.k}
          type="button"
          onClick={() => setFilter(f.k)}
          className="font-sans"
          style={{
            padding: "6px 12px",
            fontSize: 12.5,
            background: filter === f.k ? "var(--paper)" : "transparent",
            border: "1px solid",
            borderColor: filter === f.k ? "var(--rule-ink)" : "transparent",
            color: f.color ?? "var(--ink-2)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          aria-pressed={filter === f.k}
        >
          <Bi cn={f.cn} en={f.en} glossSize={0.78} />
          <span
            data-tabular
            className="font-mono text-ink-3"
            style={{ fontSize: 11 }}
          >
            {f.n}
          </span>
        </button>
      ))}
      <div
        className="text-ink-3"
        style={{
          marginLeft: "auto",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 12,
        }}
      >
        <span>
          <Bi cn="键盘" en="keys" glossSize={0.78} />
        </span>
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
        <span>nav</span>
        <Kbd>A</Kbd>
        <Kbd>E</Kbd>
        <Kbd>R</Kbd>
        <span>decide</span>
        <Kbd>⏎</Kbd>
        <span>apply</span>
      </div>
    </div>
  );
}
