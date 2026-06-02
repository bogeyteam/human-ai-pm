"use client";

/**
 * AiTagProposals — wraps <ProposalReview> for AI-suggested tags on one artifact.
 *
 * The Almanac Proposal shape doesn't yet support a "tag" kind, so we reuse
 * "task-gen" (same Accept/Edit/Reject + reason-chip layout) and stash the
 * tag metadata inside `after.titleCn / titleEn / meta`. ProposalCard renders
 * it via TaskGenBody, which gives us the same affordances for free.
 *
 * Reject reasons are tag-specific and feed back into the AI feedback loop.
 */

import * as React from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { ProposalReview } from "@/components/almanac/ProposalReview";
import type {
  Proposal,
  ProposalReviewResult,
  RejectReason,
} from "@/components/almanac/ProposalReview";
import {
  applyArtifactTags,
  suggestArtifactTags,
  type SuggestTagsResponse,
  type TagDecision,
  type TagKind,
  type TagProposalAI,
} from "@/lib/api";
import { extractError } from "@/lib/extract-error";

const TAG_REJECT_REASONS: RejectReason[] = [
  { id: "redundant", cn: "已有类似标签", en: "Redundant" },
  { id: "too_broad", cn: "太宽泛", en: "Too broad" },
  { id: "too_narrow", cn: "太具体", en: "Too narrow" },
  { id: "wrong_kind", cn: "类型不对", en: "Wrong kind" },
  { id: "off_topic", cn: "不相关", en: "Off-topic" },
];

type Phase = "loading" | "review" | "submitting" | "error";

type AiTagProposalsProps = {
  artifactId: string;
  existingTagNames: string[];
  onClose: () => void;
  onApplied: () => void | Promise<void>;
};

export function AiTagProposals({
  artifactId,
  existingTagNames,
  onClose,
  onApplied,
}: AiTagProposalsProps) {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [result, setResult] = React.useState<SuggestTagsResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Fire-and-forget on mount.
  React.useEffect(() => {
    let cancelled = false;
    setPhase("loading");
    setError(null);
    suggestArtifactTags(artifactId)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setPhase("review");
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("suggestArtifactTags failed:", err);
        setError(extractError(err));
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId]);

  const proposals: Proposal[] = React.useMemo(() => {
    if (!result) return [];
    const existing = new Set(existingTagNames.map((s) => s.toLowerCase()));
    return result.proposals.map((p: TagProposalAI, i: number): Proposal => {
      const dup = existing.has(p.tag_name.toLowerCase());
      return {
        id: String(i),
        // Reuse "task-gen" body — same Accept/Edit/Reject + reason chip
        // shape works for tag proposals. See note in the panel header below.
        kind: "task-gen",
        target: {
          type: "tag",
          id: `tag-${i}`,
          titleCn: p.tag_name,
          titleEn: p.tag_name,
        },
        before: null,
        after: {
          titleCn: p.tag_name,
          titleEn: p.tag_name,
          descCn: `${kindLabelCn(p.kind)} · ${p.rationale_cn}`,
          descEn: `${kindLabelEn(p.kind)} · ${p.rationale_en}`,
          meta: {
            owner: p.kind,
            estimate: dup ? "exists" : undefined,
          },
        },
        rationaleAi: p.rationale_en,
        rationaleAiCn: p.rationale_cn,
        confidence: dup ? 0.45 : 0.75,
      };
    });
  }, [result, existingTagNames]);

  async function handleApply(results: ProposalReviewResult[]) {
    if (!result) return;
    setPhase("submitting");
    setError(null);
    try {
      const decisions: TagDecision[] = [];
      for (const r of results) {
        const idx = parseInt(r.proposalId, 10);
        if (Number.isNaN(idx)) continue;
        if (r.decision === "skip") continue;
        const proposal = result.proposals[idx];
        if (!proposal) continue;
        if (r.decision === "accept") {
          decisions.push({ proposal_index: idx, action: "accept" });
        } else if (r.decision === "edit") {
          decisions.push({
            proposal_index: idx,
            action: "edit",
            edited_name: r.editedText?.trim() || proposal.tag_name,
            edited_kind: proposal.kind,
          });
        } else if (r.decision === "reject") {
          decisions.push({
            proposal_index: idx,
            action: "reject",
            reject_reason: r.reasonId ?? undefined,
          });
        }
      }
      await applyArtifactTags(artifactId, {
        manager_action_id: result.manager_action_id,
        decisions,
      });
      await onApplied();
    } catch (err) {
      console.error("applyArtifactTags failed:", err);
      setError(extractError(err));
      setPhase("review");
    }
  }

  return (
    <div className="border border-ai-rule bg-ai-soft/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <Micro color="var(--ai)">
          <Bi cn="AI 建议标签" en="AI tag suggestions" glossSize={0.78} />
        </Micro>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI suggestions"
          className="text-ink-3 transition hover:text-ink"
        >
          <Glyph name="cross" size={11} />
        </button>
      </div>

      {phase === "loading" && (
        <p className="text-xs italic text-ink-3">
          <Bi cn="AI 正在分析…" en="AI is analyzing…" glossSize={0.85} />
        </p>
      )}

      {phase === "error" && error && (
        <p className="border border-rust-soft bg-rust-soft/40 px-3 py-1.5 text-xs text-rust-ink">
          {error}
        </p>
      )}

      {(phase === "review" || phase === "submitting") &&
        result &&
        (proposals.length === 0 ? (
          <p className="text-xs italic text-ink-3">
            <Bi
              cn="AI 没有提出新标签"
              en="AI did not propose any new tags"
              glossSize={0.85}
            />
          </p>
        ) : (
          <div className="h-[60vh] overflow-hidden border border-rule bg-paper">
            <ProposalReview
              source="task-gen"
              proposals={proposals}
              onApply={handleApply}
              onCancel={onClose}
              rejectReasons={TAG_REJECT_REASONS}
              embedded
            />
          </div>
        ))}
    </div>
  );
}

function kindLabelCn(k: TagKind): string {
  switch (k) {
    case "topic":
      return "主题";
    case "phase":
      return "阶段";
    case "persona":
      return "角色";
    default:
      return "自定义";
  }
}

function kindLabelEn(k: TagKind): string {
  return k.charAt(0).toUpperCase() + k.slice(1);
}
