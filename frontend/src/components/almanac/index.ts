/**
 * Almanac primitives barrel.
 *
 * Single import surface for all Day-3 primitives + the signature
 * <ProposalReview> component. Page-level imports should pull from here:
 *
 *   import { Bi, Micro, ProposalReview } from "@/components/almanac";
 */

export { Bi, BiE } from "./Bi";
export { Micro } from "./Micro";
export { Glyph } from "./Glyph";
export type { GlyphName } from "./Glyph";
export { Kbd } from "./Kbd";
export { Chip } from "./Chip";
export { Rule } from "./Rule";
export { AIText } from "./AIText";
export { Mark } from "./Mark";
export { ThemeToggle } from "./ThemeToggle";

export { ProposalReview, REJECT_REASONS, SEED_PROPOSALS } from "./ProposalReview";
export type {
  Proposal,
  ProposalKind,
  ProposalReviewProps,
  ProposalReviewResult,
  Decision,
  RejectReason,
} from "./ProposalReview";
