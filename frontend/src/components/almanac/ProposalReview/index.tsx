"use client";

/**
 * ProposalReview — the signature interaction for the AI Manager Platform.
 *
 * One component, four call-sites:
 *   M5 task-gen   — Brainstorm → tasks
 *   M6 finding    — Cross-task findings (dismiss / open)
 *   M7 optimizer  — Weekly backlog review
 *   M11 meeting   — Post-meeting action items
 *
 * All four emit proposals with the shared `Proposal` shape; this component
 * renders them, captures Accept / Edit / Reject / Skip decisions plus an
 * optional reject-reason or edited-text, and hands the result array to
 * `onApply`. Nothing auto-mutates the task graph — that's the back-end's job
 * after the user clicks Apply.
 *
 * Keyboard:
 *   J / ArrowDown   — next proposal
 *   K / ArrowUp     — prev proposal
 *   A / E / R / S   — decide on focused proposal (toggle off if same key)
 *   1..9            — pick reject reason (only while reject open on focused)
 *   Enter           — Apply (if enabled)
 *   ⌘+Enter         — Apply (always tries)
 *   Escape          — Cancel
 *
 * Apply is disabled while any proposal is pending OR any rejected proposal
 * has no reason. (Skip counts as decided.)
 */

import * as React from "react";
import { Bi } from "../Bi";
import { Glyph } from "../Glyph";
import { FilterBar, type FilterKey } from "./FilterBar";
import { ReviewHeader } from "./Header";
import { ProposalCard } from "./ProposalCard";
import { Tallies } from "./Tally";
import { REJECT_REASONS, SEED_PROPOSALS, SOURCE_LABELS } from "./constants";
import type {
  Decision,
  DecisionMap,
  ProposalReviewProps,
  ProposalReviewResult,
} from "./types";

export { REJECT_REASONS, SEED_PROPOSALS } from "./constants";
export type {
  Decision,
  Proposal,
  ProposalKind,
  ProposalReviewProps,
  ProposalReviewResult,
  RejectReason,
} from "./types";

export function ProposalReview({
  source,
  proposals,
  onApply,
  onCancel,
  rejectReasons = REJECT_REASONS,
  embedded = false,
}: ProposalReviewProps) {
  const [decisions, setDecisions] = React.useState<DecisionMap>({});
  const [filter, setFilter] = React.useState<FilterKey>("all");
  const [focusedId, setFocusedId] = React.useState<string | null>(
    proposals[0]?.id ?? null,
  );
  const [applying, setApplying] = React.useState(false);

  const cardRefs = React.useRef<Record<string, HTMLElement | null>>({});

  // Keep focus in-sync if proposals identity changes.
  React.useEffect(() => {
    if (focusedId && proposals.some((p) => p.id === focusedId)) return;
    setFocusedId(proposals[0]?.id ?? null);
  }, [proposals, focusedId]);

  /* ────────────────────────────────────────────────────────
     Derived: filtered view + counts.
     ──────────────────────────────────────────────────────── */
  const visible = React.useMemo(() => {
    if (filter === "all") return proposals;
    return proposals.filter((p) => decisions[p.id]?.decision === filter);
  }, [filter, decisions, proposals]);

  const counts = React.useMemo(() => {
    const c = { accept: 0, edit: 0, reject: 0, skip: 0, pending: 0 };
    for (const p of proposals) {
      const d = decisions[p.id]?.decision;
      if (d) c[d] += 1;
      else c.pending += 1;
    }
    return c;
  }, [decisions, proposals]);

  const canApply = React.useMemo(() => {
    if (counts.pending > 0) return false;
    for (const p of proposals) {
      const d = decisions[p.id];
      if (d?.decision === "reject" && !d.reason) return false;
    }
    return counts.accept + counts.edit + counts.reject > 0;
  }, [counts, decisions, proposals]);

  /* ────────────────────────────────────────────────────────
     Action helpers
     ──────────────────────────────────────────────────────── */
  const decide = React.useCallback(
    (id: string, decision: Exclude<Decision, null>) => {
      setDecisions((prev) => {
        const cur = prev[id]?.decision;
        if (cur === decision) {
          // Toggle off
          const { [id]: _omit, ...rest } = prev;
          return rest;
        }
        const next = { ...prev[id], decision };
        if (decision !== "reject") delete next.reason;
        if (decision !== "edit") delete next.editedText;
        return { ...prev, [id]: next };
      });
    },
    [],
  );

  const setReason = React.useCallback((id: string, reason: string) => {
    setDecisions((prev) => ({
      ...prev,
      [id]: { ...prev[id], reason },
    }));
  }, []);

  const setEditText = React.useCallback((id: string, text: string) => {
    setDecisions((prev) => ({
      ...prev,
      [id]: { ...prev[id], editedText: text },
    }));
  }, []);

  const focusProposal = React.useCallback((id: string | null) => {
    if (!id) return;
    setFocusedId(id);
    const el = cardRefs.current[id];
    if (el) {
      el.focus({ preventScroll: false });
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, []);

  const focusOffset = React.useCallback(
    (offset: 1 | -1) => {
      if (!focusedId) {
        if (visible[0]) focusProposal(visible[0].id);
        return;
      }
      const idx = visible.findIndex((p) => p.id === focusedId);
      if (idx === -1) return;
      const nextIdx = Math.max(0, Math.min(visible.length - 1, idx + offset));
      focusProposal(visible[nextIdx]?.id ?? null);
    },
    [focusedId, visible, focusProposal],
  );

  const buildResults = React.useCallback((): ProposalReviewResult[] => {
    const out: ProposalReviewResult[] = [];
    for (const p of proposals) {
      const d = decisions[p.id];
      if (!d?.decision) continue;
      out.push({
        proposalId: p.id,
        decision: d.decision,
        reasonId: d.reason ?? null,
        editedText: d.editedText ?? null,
      });
    }
    return out;
  }, [proposals, decisions]);

  const handleApply = React.useCallback(async () => {
    if (!canApply || applying) return;
    setApplying(true);
    try {
      await onApply(buildResults());
    } finally {
      setApplying(false);
    }
  }, [canApply, applying, onApply, buildResults]);

  /* ────────────────────────────────────────────────────────
     Keyboard router — registered on container, listens to keys
     when focus is inside the modal. Skip when inside an input.
     ──────────────────────────────────────────────────────── */
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    function inEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function onKey(e: KeyboardEvent) {
      // Always handle Escape + ⌘+Enter even from inside a textarea.
      const isCmdEnter = (e.metaKey || e.ctrlKey) && e.key === "Enter";
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel?.();
        return;
      }
      if (isCmdEnter) {
        e.preventDefault();
        void handleApply();
        return;
      }
      if (inEditable(e.target)) return;

      switch (e.key) {
        case "j":
        case "J":
        case "ArrowDown":
          e.preventDefault();
          focusOffset(1);
          return;
        case "k":
        case "K":
        case "ArrowUp":
          e.preventDefault();
          focusOffset(-1);
          return;
        case "a":
        case "A":
          if (focusedId) {
            e.preventDefault();
            decide(focusedId, "accept");
          }
          return;
        case "e":
        case "E":
          if (focusedId) {
            e.preventDefault();
            decide(focusedId, "edit");
          }
          return;
        case "r":
        case "R":
          if (focusedId) {
            e.preventDefault();
            decide(focusedId, "reject");
          }
          return;
        case "s":
        case "S":
          if (focusedId) {
            e.preventDefault();
            decide(focusedId, "skip");
          }
          return;
        case "Enter":
          e.preventDefault();
          void handleApply();
          return;
        default: {
          // 1..9 → pick reject reason on focused card if reject panel open
          if (focusedId && /^[1-9]$/.test(e.key)) {
            const focused = decisions[focusedId];
            if (focused?.decision === "reject") {
              const idx = Number(e.key) - 1;
              const r = rejectReasons[idx];
              if (r) {
                e.preventDefault();
                setReason(focusedId, r.id);
              }
            }
          }
        }
      }
    }
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [
    focusedId,
    focusOffset,
    decide,
    setReason,
    handleApply,
    onCancel,
    decisions,
    rejectReasons,
  ]);

  /* ────────────────────────────────────────────────────────
     Header / source label
     ──────────────────────────────────────────────────────── */
  const sourceLabel = SOURCE_LABELS[source] ?? { cn: source, en: source };
  const total = proposals.length;
  const decidedCount = counts.accept + counts.edit + counts.reject;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="dialog"
      aria-label="AI Proposal Review"
      className="almanac"
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "stretch",
        background: embedded ? "transparent" : "oklch(0.22 0.014 60 / 0.32)",
        padding: embedded ? 0 : "32px 48px",
        boxSizing: "border-box",
        outline: "none",
      }}
    >
      <section
        className="bg-paper"
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          border: embedded ? "none" : "1px solid var(--rule-ink)",
          boxShadow: embedded ? "none" : "0 30px 80px -40px rgba(40, 24, 12, 0.18)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <ReviewHeader
          titleCn={sourceLabel.cn}
          titleEn={sourceLabel.en}
          total={total}
          counts={counts}
          onCancel={onCancel}
        />

        <FilterBar
          filter={filter}
          setFilter={setFilter}
          counts={counts}
          total={total}
        />

        {/* Proposal stack */}
        <div style={{ flex: 1, overflow: "auto" }}>
          {visible.map((p) => {
            const d = decisions[p.id];
            return (
              <ProposalCard
                key={p.id}
                p={p}
                idx={proposals.indexOf(p)}
                total={total}
                decision={d?.decision}
                reasonId={d?.reason}
                editedText={d?.editedText}
                focused={focusedId === p.id}
                rejectReasons={rejectReasons}
                onDecide={(dec) => decide(p.id, dec)}
                onReason={(r) => setReason(p.id, r)}
                onEditText={(t) => setEditText(p.id, t)}
                onFocus={() => setFocusedId(p.id)}
                registerRef={(el) => {
                  cardRefs.current[p.id] = el;
                }}
              />
            );
          })}
          {visible.length === 0 && (
            <div
              className="text-ink-3"
              style={{ padding: "60px 32px", textAlign: "center" }}
            >
              <Glyph name="circle" size={20} color="var(--ink-4)" />
              <div style={{ marginTop: 12, fontSize: 13 }}>
                <Bi cn="此筛选下没有项目" en="Nothing under this filter" glossSize={0.78} />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer
          className="bg-paper-2"
          style={{
            padding: "16px 32px",
            borderTop: "1px solid var(--rule-ink)",
            display: "flex",
            alignItems: "center",
            gap: 18,
            flexWrap: "wrap",
          }}
        >
          <div
            className="text-ink-2"
            style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, minWidth: 200 }}
          >
            <Tallies counts={counts} />
          </div>

          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="btn"
            >
              <Bi cn="取消" en="Cancel" glossSize={0.78} />
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={!canApply || applying}
            className="btn btn-primary"
            style={{
              padding: "8px 18px",
              opacity: !canApply || applying ? 0.45 : 1,
              cursor: !canApply || applying ? "not-allowed" : "pointer",
            }}
          >
            <Bi
              cn={applying ? "应用中…" : `应用 ${decidedCount} 项`}
              en={applying ? "Applying…" : `Apply ${decidedCount}`}
              glossSize={0.74}
            />
            <Glyph
              name="return"
              size={11}
              style={{ marginLeft: 8, color: "currentColor", opacity: 0.7 }}
            />
          </button>
        </footer>
      </section>
    </div>
  );
}

/** Bound demo data, for the smoke-test page. */
export const __PROPOSAL_REVIEW_TEST__ = { SEED_PROPOSALS };
