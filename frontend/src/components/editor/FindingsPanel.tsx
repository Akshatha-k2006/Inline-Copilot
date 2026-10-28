"use client";

import type { DemoFinding } from "@/lib/mock-findings";
import type { FindingStatus } from "@/lib/types";
import FindingCard from "./FindingCard";

interface FindingsPanelProps {
  findings: DemoFinding[] | null;
  busyFindingIds: number[];
  readOnly?: boolean;
  reviewState?: "loading" | "error" | "not-run" | "stale" | "current";
  reviewing?: boolean;
  canRunReview?: boolean;
  onRunReview?: () => void;
  selectedFindingId: number | null;
  reviewedCustomText: boolean;
  onSelect: (finding: DemoFinding) => void;
  onResolve?: (
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
    dismissalReason?: string,
  ) => Promise<void>;
}

export default function FindingsPanel({
  findings,
  busyFindingIds,
  readOnly = false,
  reviewState = "not-run",
  reviewing = false,
  canRunReview = false,
  onRunReview,
  selectedFindingId,
  reviewedCustomText,
  onSelect,
  onResolve,
}: FindingsPanelProps) {
  const activeFindings =
    findings?.filter((finding) => finding.status === "open") ?? [];
  const resolvedFindings =
    findings?.filter((finding) => finding.status !== "open") ?? [];
  const highCount = activeFindings.filter(
    (finding) => finding.severity === "high",
  ).length;
  const warningCount = activeFindings.filter((finding) => finding.severity === "medium").length;
  const infoCount = activeFindings.filter((finding) => finding.severity === "low").length;
  const dismissedCount = resolvedFindings.filter((finding) => finding.status === "dismissed").length;

  return (
    <section className="editor-card findings-panel" aria-labelledby="findings-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Review results</p>
          <h2 id="findings-heading">
            {findings === null
              ? "Findings"
              : `${activeFindings.length} open ${activeFindings.length === 1 ? "finding" : "findings"}`}
          </h2>
        </div>
        {activeFindings.length > 0 && (
          <span className="finding-count">{highCount} errors · {warningCount} warnings · {infoCount} info</span>
        )}
      </div>

      {findings === null ? (
        <div className="editor-empty-state">
          <span className="empty-state-mark" aria-hidden="true">✓</span>
          <h3>
            {reviewState === "loading"
              ? "Loading review results"
              : reviewState === "error"
                ? "Review results unavailable"
                : reviewState === "stale"
                  ? "Review this version again"
                  : "Review not run yet"}
          </h3>
          <p>
            {reviewState === "loading"
              ? "The local demo review is still loading."
              : reviewState === "error"
                ? "The local demo review could not be completed. This is not a successful empty review."
                : reviewState === "stale"
                  ? "The draft changed after its last review, so those results are out of date. Review this version again."
                  : readOnly
                    ? "No demo review is recorded for this content yet."
                    : "Review the draft to check its configured guidelines, terminology, and facts."}
          </p>
          {canRunReview && onRunReview && (
            <button
              type="button"
              className="button button-primary"
              onClick={onRunReview}
              disabled={reviewing || reviewState === "loading" || reviewState === "error"}
            >
              {reviewing ? "Reviewing content..." : "Review content"}
            </button>
          )}
        </div>
      ) : activeFindings.length === 0 ? (
        <div className="editor-empty-state success-state" role="status">
          <span className="empty-state-mark" aria-hidden="true">
            {reviewedCustomText || resolvedFindings.length > 0 ? "i" : "✓"}
          </span>
          <h3>
            {reviewedCustomText
              ? "No findings for this text"
              : resolvedFindings.length > 0
                ? "No open findings"
                : "No findings"}
          </h3>
          <p>
            {reviewedCustomText
              ? "The demo engine did not identify configured issues in this draft. Editorial approval may still be required."
              : resolvedFindings.length > 0
                ? "Resolved findings remain below for reference. This does not indicate a verified review result."
                  : "The demo engine detected no configured issues in this content. It does not replace editorial approval."}
          </p>
        </div>
      ) : (
        <div className="finding-list">
          {activeFindings.map((finding) => (
            <FindingCard
              key={finding.id}
              id={`finding-card-${finding.id}`}
              finding={finding}
              busy={busyFindingIds.includes(finding.id)}
              readOnly={readOnly}
              selected={selectedFindingId === finding.id}
              onSelect={onSelect}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}
      {resolvedFindings.length > 0 && (
        <section className="resolved-findings" aria-labelledby="resolved-findings-heading">
          <h3 id="resolved-findings-heading">Resolved ({resolvedFindings.length}) · Dismissed ({dismissedCount})</h3>
          <ul>
            {resolvedFindings.map((finding) => (
              <li key={finding.id} id={`finding-card-${finding.id}`}>
                <span className={`finding-status status-${finding.status}`}>
                  {finding.status}
                </span>
                <span>{finding.check.replaceAll("_", " ")}</span>
                <q>{finding.text}</q>
                {finding.final_text && (
                  <span className="resolved-final-text">
                    {"-> "}{finding.final_text}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
