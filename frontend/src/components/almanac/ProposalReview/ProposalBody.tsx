/**
 * ProposalBody — switches rendering on proposal kind.
 *
 *   task-gen   → title + bilingual description + meta pairs (owner / size / due / links)
 *   optimizer  → before / → / after side-by-side state diff
 *   finding    → severity + paper-2 quoted next-step proposal
 *   meeting    → kicker + title + owner / due meta
 *
 * Defensive: this reads from `p.after` and `p.before` which are typed loose
 * by intention so backend payloads can be passed through; access is guarded.
 */

import * as React from "react";
import { Bi } from "../Bi";
import { Glyph } from "../Glyph";
import { Micro } from "../Micro";
import type { Proposal } from "./types";

type ProposalBodyProps = {
  p: Proposal;
};

export function ProposalBody({ p }: ProposalBodyProps) {
  if (p.kind === "optimizer") return <OptimizerBody p={p} />;
  if (p.kind === "task-gen") return <TaskGenBody p={p} />;
  if (p.kind === "finding") return <FindingBody p={p} />;
  return <MeetingBody p={p} />;
}

/* ────────────────────────────────────────────────────────────
   Per-kind sub-bodies. Kept here to mirror the source layout
   without polluting the index.
   ──────────────────────────────────────────────────────────── */

function OptimizerBody({ p }: { p: Proposal }) {
  return (
    <div>
      <h3
        className="font-sc"
        style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}
      >
        {p.target.titleCn}
        <span
          className="font-sans text-ink-2"
          style={{ fontSize: "0.84em", marginLeft: "0.5em", fontWeight: 400 }}
        >
          {p.target.titleEn}
        </span>
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 24px 1fr",
          gap: 14,
          marginTop: 14,
          alignItems: "stretch",
        }}
      >
        <DiffSide
          label={<Bi cn="当前" en="now" glossSize={0.78} />}
          state={p.before ?? null}
          muted
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--clay)",
          }}
        >
          <Glyph name="arrow" size={18} />
        </div>
        <DiffSide
          label={<Bi cn="建议" en="proposed" glossSize={0.78} />}
          state={p.after}
          highlight
        />
      </div>
    </div>
  );
}

function TaskGenBody({ p }: { p: Proposal }) {
  const meta = p.after.meta;
  return (
    <div>
      <h3
        className="font-sc"
        style={{ fontSize: 17, fontWeight: 500, marginBottom: 6, lineHeight: 1.3 }}
      >
        {p.after.titleCn}
        <span
          className="font-sans text-ink-2"
          style={{ fontSize: "0.82em", marginLeft: "0.5em", fontWeight: 400 }}
        >
          {p.after.titleEn}
        </span>
      </h3>
      <p
        className="font-sc text-ink-2"
        style={{ fontSize: 13.5, lineHeight: 1.65, marginTop: 4 }}
      >
        {p.after.descCn}
      </p>
      <p
        className="text-ink-3"
        style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 2 }}
      >
        {p.after.descEn}
      </p>
      {meta && (
        <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
          {meta.owner != null && <MetaPair k="owner" v={meta.owner} />}
          {meta.estimate != null && <MetaPair k="size" v={meta.estimate} />}
          {meta.deadline != null && <MetaPair k="due" v={meta.deadline} />}
          {meta.linksTo?.map((l) => (
            <MetaPair key={l} k="links" v={l} mono />
          ))}
        </div>
      )}
    </div>
  );
}

function FindingBody({ p }: { p: Proposal }) {
  return (
    <div>
      <h3
        className="font-sc"
        style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}
      >
        {p.target.titleCn}
        <span
          className="font-sans text-ink-2"
          style={{ fontSize: "0.84em", marginLeft: "0.5em", fontWeight: 400 }}
        >
          {p.target.titleEn}
        </span>
      </h3>
      <div
        className="bg-paper-2"
        style={{
          marginTop: 10,
          padding: "12px 14px",
          borderLeft: "2px solid var(--clay)",
        }}
      >
        <Micro style={{ marginBottom: 4 }}>Proposed next step · 建议下一步</Micro>
        <div
          className="font-sc"
          style={{ fontSize: 14, lineHeight: 1.55 }}
        >
          {p.after.proposalCn}
        </div>
        <div
          className="text-ink-3"
          style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 4 }}
        >
          {p.after.proposal}
        </div>
      </div>
    </div>
  );
}

function MeetingBody({ p }: { p: Proposal }) {
  return (
    <div>
      <Micro style={{ marginBottom: 6 }}>From meeting · {p.target.titleCn}</Micro>
      <h3
        className="font-sc"
        style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}
      >
        {p.after.titleCn}
        <span
          className="font-sans text-ink-2"
          style={{ fontSize: "0.84em", marginLeft: "0.5em", fontWeight: 400 }}
        >
          {p.after.titleEn}
        </span>
      </h3>
      <div style={{ display: "flex", gap: 18, marginTop: 8, flexWrap: "wrap" }}>
        {p.after.owner != null && <MetaPair k="owner" v={String(p.after.owner)} />}
        {p.after.deadline != null && <MetaPair k="due" v={String(p.after.deadline)} />}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   Helpers — DiffSide + MetaPair
   ──────────────────────────────────────────────────────────── */

type DiffSideProps = {
  label: React.ReactNode;
  state: Record<string, unknown> | null;
  muted?: boolean;
  highlight?: boolean;
};

function DiffSide({ label, state, muted, highlight }: DiffSideProps) {
  if (!state) {
    return (
      <div
        className="text-ink-3"
        style={{
          padding: "10px 14px",
          border: "1px dashed var(--rule)",
          fontSize: 12.5,
        }}
      >
        —
      </div>
    );
  }
  return (
    <div
      style={{
        border: `1px solid ${highlight ? "var(--clay)" : "var(--rule)"}`,
        background: highlight ? "var(--clay-soft)" : "var(--paper-2)",
        padding: "10px 14px",
      }}
    >
      <Micro
        style={{
          marginBottom: 8,
          color: muted ? "var(--ink-3)" : highlight ? "var(--clay-ink)" : "var(--ink-2)",
        }}
      >
        {label}
      </Micro>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {Object.entries(state).map(([k, v]) => (
          <div key={k} style={{ display: "flex", gap: 8, fontSize: 13 }}>
            <span
              className="font-mono text-ink-3"
              style={{ fontSize: 11, width: 56 }}
            >
              {k}
            </span>
            <span className="font-sans text-ink">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type MetaPairProps = {
  k: string;
  v: React.ReactNode;
  mono?: boolean;
};

function MetaPair({ k, v, mono }: MetaPairProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="micro" style={{ fontSize: 10 }}>
        {k}
      </span>
      <span
        className={`text-ink ${mono ? "font-mono" : "font-sans"}`}
        style={{ fontSize: 13 }}
      >
        {v}
      </span>
    </div>
  );
}
