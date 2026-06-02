"use client";

/**
 * /almanac-demo — visual smoke-test surface for the Almanac primitives
 * and the signature <ProposalReview> component.
 *
 * This route is intentionally not linked from the app nav. It exists so
 * engineers can verify the Day-3 components render with the seed data
 * from the design bundle, plus exercise the keyboard handlers in isolation
 * before the companion typography PR lands and we migrate real pages.
 */

import * as React from "react";
import {
  ProposalReview,
  SEED_PROPOSALS,
  type ProposalReviewResult,
} from "@/components/almanac";

export default function AlmanacDemoPage() {
  const [lastApplied, setLastApplied] = React.useState<ProposalReviewResult[] | null>(null);
  const [closed, setClosed] = React.useState(false);

  const handleApply = React.useCallback(async (results: ProposalReviewResult[]) => {
    setLastApplied(results);
    // eslint-disable-next-line no-console
    console.log("[almanac-demo] apply", results);
  }, []);

  const handleCancel = React.useCallback(() => {
    setClosed(true);
    // eslint-disable-next-line no-console
    console.log("[almanac-demo] cancel");
  }, []);

  if (closed) {
    return (
      <main style={{ minHeight: "100vh", padding: 48 }} className="almanac almanac-paper">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setClosed(false)}
        >
          Reopen ProposalReview
        </button>
        {lastApplied && (
          <pre
            className="font-mono"
            style={{
              marginTop: 24,
              padding: 16,
              background: "var(--paper-2)",
              border: "1px solid var(--rule)",
              fontSize: 12,
              overflow: "auto",
            }}
          >
            {JSON.stringify(lastApplied, null, 2)}
          </pre>
        )}
      </main>
    );
  }

  return (
    <main style={{ minHeight: "100vh" }} className="almanac almanac-paper">
      <ProposalReview
        source="optimizer"
        proposals={SEED_PROPOSALS}
        onApply={handleApply}
        onCancel={handleCancel}
      />
    </main>
  );
}
