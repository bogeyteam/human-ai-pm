/**
 * KindLabel — pill announcing which AI feature spawned this proposal.
 *
 * Mono uppercase EN inside an ink-bordered pill, with the CN gloss
 * to the right. Maps proposal `kind` → display label.
 */

import * as React from "react";
import type { ProposalKind } from "./types";

type KindLabelProps = {
  kind: ProposalKind | string;
};

const MAP: Record<string, { cn: string; en: string }> = {
  "task-gen": { cn: "新任务", en: "task" },
  optimizer: { cn: "调度", en: "move" },
  finding: { cn: "发现", en: "finding" },
  meeting: { cn: "行动项", en: "action" },
};

export function KindLabel({ kind }: KindLabelProps) {
  const m = MAP[kind] ?? { cn: kind, en: kind };
  return (
    <span
      className="font-mono uppercase text-ink border border-rule-ink"
      style={{
        fontSize: 10.5,
        padding: "2px 7px 1px",
        letterSpacing: "0.04em",
      }}
    >
      {m.en}
      <span className="font-sc text-ink-2" style={{ marginLeft: 6, fontWeight: 400 }}>
        {m.cn}
      </span>
    </span>
  );
}
