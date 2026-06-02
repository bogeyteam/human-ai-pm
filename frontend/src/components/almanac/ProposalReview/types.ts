/**
 * Shared types for the ProposalReview component family.
 *
 * The four AI features (M5 task-gen, M6 finding, M7 optimizer, M11 meeting)
 * all emit proposals that share this shape. `kind` switches the body
 * rendering inside ProposalCard; everything else is uniform.
 */

export type ProposalKind = "task-gen" | "optimizer" | "finding" | "meeting";

export type Decision = "accept" | "edit" | "reject" | "skip" | null;

export type RejectReason = {
  id: string;
  cn: string;
  en: string;
};

/** Loose metadata bag — varies by `kind`. Keep flexible so backend
 *  proposal shapes from M5/M6/M7/M11 can be passed through without
 *  marshalling. ProposalBody is responsible for safe access.
 */
export type ProposalAfter = Record<string, unknown> & {
  // common task / meeting fields
  titleCn?: string;
  titleEn?: string;
  descCn?: string;
  descEn?: string;
  owner?: string;
  deadline?: string;
  meta?: {
    owner?: string;
    estimate?: string;
    deadline?: string;
    linksTo?: string[];
  };
  // finding fields
  severity?: string;
  proposal?: string;
  proposalCn?: string;
  // optimizer (state diff) fields
  status?: string;
  // meeting fields
  kind?: string;
};

export type Proposal = {
  id: string;
  kind: ProposalKind;
  target: {
    type: string;
    id: string;
    titleCn?: string;
    titleEn?: string;
  };
  before?: Record<string, unknown> | null;
  after: ProposalAfter;
  /** AI rationale in English. */
  rationaleAi: string;
  /** AI rationale in Chinese. */
  rationaleAiCn: string;
  /** 0..1 — model self-reported confidence. */
  confidence: number;
  /** Reject reason id (when the user has decided "reject"). Server may pre-fill. */
  reason?: string | null;
};

export type ProposalReviewResult = {
  proposalId: string;
  decision: Exclude<Decision, null>;
  reasonId?: string | null;
  editedText?: string | null;
};

export type ProposalReviewProps = {
  /** Source feature; drives the header copy. Pass one of the canonical
   *  ProposalKind values, or any string for a custom source label fallback. */
  source: ProposalKind | string;
  proposals: Proposal[];
  onApply: (results: ProposalReviewResult[]) => Promise<void> | void;
  onCancel?: () => void;
  /** Override the default reject-reason set (used by M6 finding dismiss). */
  rejectReasons?: RejectReason[];
  /** Display in an inline embedded mode (no backdrop). Default false → modal. */
  embedded?: boolean;
};

export type DecisionState = {
  decision?: Exclude<Decision, null>;
  reason?: string | null;
  editedText?: string | null;
};

export type DecisionMap = Record<string, DecisionState>;
