"use client";

import type { DemoFinding } from "@/lib/mock-findings";
import type { FindingStatus } from "@/lib/types";
import FindingCard from "./FindingCard";

interface FindingsPanelProps {
  findings: DemoFinding[] | null;
  busyFindingIds: number[];
  readOnly?: boolean;
  selectedFindingId: number | null;
  reviewedCustomText: boolean;
  onSelect: (finding: DemoFinding) => void;
  onResolve?: (
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
  ) => Promise<void>;
}

export default function FindingsPanel({
  findings,
  busyFindingIds,
  readOnly = false,
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
          <span className="finding-count">{highCount} error severity</span>
        )}
      </div>

      {findings === null ? (
        <div className="editor-empty-state">
          <span className="empty-state-mark" aria-hidden="true">✓</span>
          <h3>Your review will appear here</h3>
          <p>{readOnly ? "No current mock findings are available for this content." : "Run the demonstration review to see matching guideline, terminology, and fact findings."}</p>
          <p>Run the demonstration review to see its guideline, terminology, and fact findings.</p>
        </div>
      ) : activeFindings.length === 0 ? (
        <div className="editor-empty-state success-state" role="status">
          <span className="empty-state-mark" aria-hidden="true">
            {reviewedCustomText || resolvedFindings.length > 0 ? "i" : "✓"}
          </span>
          <h3>
            {reviewedCustomText
              ? "No demo findings for this text"
              : resolvedFindings.length > 0
                ? "No open findings"
                : "No findings"}
          </h3>
          <p>
            {reviewedCustomText
              ? "The local demo has findings for its sample draft only. This does not mean your custom content has passed a review."
              : resolvedFindings.length > 0
                ? "Resolved findings remain below for reference. This does not indicate a verified review result."
                  : "There are no findings to display."}
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
          <h3 id="resolved-findings-heading">Resolved findings ({resolvedFindings.length})</h3>
          <ul>
            {resolvedFindings.map((finding) => (
              <li key={finding.id}>
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
