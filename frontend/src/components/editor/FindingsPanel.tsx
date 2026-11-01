"use client";

import type { DemoFinding } from "@/lib/findings";
import type { FindingStatus } from "@/lib/types";
import type { EvidenceRequest } from "@/lib/types";
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
  evidenceRequests?: EvidenceRequest[];
  evidenceLoading?: boolean;
  evidenceError?: string;
  onRequestEvidence?: (
    finding: DemoFinding,
    reason: string,
    assignee: string,
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
  evidenceRequests = [],
  evidenceLoading = false,
  evidenceError = "",
  onRequestEvidence,
}: FindingsPanelProps) {
  const activeFindings =
    findings?.filter((finding) => finding.status === "open") ?? [];
  const resolvedFindings =
    findings?.filter((finding) => finding.status !== "open") ?? [];
  const highCount = activeFindings.filter(
    (finding) => finding.severity === "high",
  ).length;
  const warningCount = activeFindings.filter(
    (finding) => finding.severity === "medium",
  ).length;
  const infoCount = activeFindings.filter(
    (finding) => finding.severity === "low",
  ).length;
  const dismissedCount = resolvedFindings.filter(
    (finding) => finding.status === "dismissed",
  ).length;

  return (
    <section
      className="editor-card findings-panel"
      aria-labelledby="findings-heading"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Review results</p>
          <h2 id="findings-heading">
            {reviewing
              ? "Reviewing..."
              : findings === null
                ? "Findings"
                : `${activeFindings.length} open ${activeFindings.length === 1 ? "finding" : "findings"}`}
          </h2>
        </div>
        {activeFindings.length > 0 && !reviewing && (
          <div className="finding-summary" aria-label="Open findings by severity">
            <span
              className={`finding-summary-chip finding-summary-chip-high${highCount === 0 ? " is-zero" : ""}`}
            >
              <strong>{highCount}</strong>
              {highCount === 1 ? "error" : "errors"}
            </span>
            <span
              className={`finding-summary-chip finding-summary-chip-medium${warningCount === 0 ? " is-zero" : ""}`}
            >
              <strong>{warningCount}</strong>
              {warningCount === 1 ? "warning" : "warnings"}
            </span>
            <span
              className={`finding-summary-chip finding-summary-chip-low${infoCount === 0 ? " is-zero" : ""}`}
            >
              <strong>{infoCount}</strong>
              info
            </span>
          </div>
        )}
      </div>

      {reviewing || reviewState === "loading" ? (
        <div className="findings-scroll">
          <div className="editor-empty-state" role="status" aria-live="polite">
            <span className="empty-state-mark" aria-hidden="true">
              …
            </span>
            <h3>Reviewing content</h3>
            <p>
              Checking tone, terminology, claims, and approved facts. This
              usually takes a few seconds.
            </p>
          </div>
        </div>
      ) : reviewState === "error" ? (
        <div className="findings-scroll">
          <div className="editor-empty-state">
            <span className="empty-state-mark" aria-hidden="true">
              !
            </span>
            <h3>Review results unavailable</h3>
            <p>
              The backend review could not be completed. This is not a
              successful empty review.
            </p>
          </div>
        </div>
      ) : reviewState !== "current" ? (
        <div className="findings-scroll">
          <div className="editor-empty-state">
            <span className="empty-state-mark" aria-hidden="true">
              ✓
            </span>
            <h3>
              {reviewState === "stale"
                ? "Review this version again"
                : "Review not run yet"}
            </h3>
            <p>
              {reviewState === "stale"
                ? "The draft changed after its last review, so those results are out of date. Review this version again."
                : readOnly
                  ? "No backend review is recorded for this content yet."
                  : "Review the draft to check its configured guidelines, terminology, and facts."}
            </p>
            {canRunReview && onRunReview && (
              <button
                type="button"
                className="button button-primary"
                onClick={onRunReview}
              >
                Review content
              </button>
            )}
          </div>
        </div>
      ) : activeFindings.length === 0 ? (
        <div className="findings-scroll">
          <div
            className="editor-empty-state success-state"
            role="status"
          >
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
                ? "The backend review did not identify configured issues in this draft. Editorial approval may still be required."
                : resolvedFindings.length > 0
                  ? "Resolved findings remain collapsed below for reference. This does not indicate a verified review result."
                  : "The backend review detected no configured issues in this content. It does not replace editorial approval."}
            </p>
          </div>
          {resolvedFindings.length > 0 && (
            <details className="resolved-findings">
              <summary>
                Resolved ({resolvedFindings.length}) · Dismissed (
                {dismissedCount})
              </summary>
              <ul>
                {resolvedFindings.map((finding) => (
                  <li key={finding.id} id={`finding-card-${finding.id}`}>
                    <span
                      className={`finding-status status-${finding.status}`}
                    >
                      {finding.status}
                    </span>
                    <span>
                      {String(finding.check ?? "Unknown").replaceAll("_", " ")}
                    </span>
                    <q>{finding.text}</q>
                    {finding.final_text && (
                      <span className="resolved-final-text">
                        {"-> "}
                        {finding.final_text}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : (
        <div className="findings-scroll">
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
                evidenceRequests={evidenceRequests.filter(
                  (request) => request.findingId === finding.id,
                )}
                evidenceLoading={evidenceLoading}
                evidenceError={evidenceError}
                onRequestEvidence={onRequestEvidence}
              />
            ))}
          </div>
          {resolvedFindings.length > 0 && (
            <details className="resolved-findings">
              <summary>
                Resolved ({resolvedFindings.length}) · Dismissed (
                {dismissedCount})
              </summary>
              <ul>
                {resolvedFindings.map((finding) => (
                  <li key={finding.id} id={`finding-card-${finding.id}`}>
                    <span
                      className={`finding-status status-${finding.status}`}
                    >
                      {finding.status}
                    </span>
                    <span>
                      {String(finding.check ?? "Unknown").replaceAll("_", " ")}
                    </span>
                    <q>{finding.text}</q>
                    {finding.final_text && (
                      <span className="resolved-final-text">
                        {"-> "}
                        {finding.final_text}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
