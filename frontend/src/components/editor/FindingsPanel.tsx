"use client";

import type { DemoFinding } from "@/lib/mock-findings";
import type { FindingStatus } from "@/lib/types";
import FindingCard from "./FindingCard";

interface FindingsPanelProps {
  findings: DemoFinding[] | null;
  busyFindingIds: number[];
  selectedFindingId: number | null;
  reviewedCustomText: boolean;
  onSelect: (finding: DemoFinding) => void;
  onResolve: (
    finding: DemoFinding,
    status: FindingStatus,
    finalText: string | null,
  ) => Promise<void>;
}

export default function FindingsPanel({
  findings,
  busyFindingIds,
  selectedFindingId,
  reviewedCustomText,
  onSelect,
  onResolve,
}: FindingsPanelProps) {
  const highCount = findings?.filter((finding) => finding.severity === "high").length ?? 0;

  return (
    <section className="editor-card findings-panel" aria-labelledby="findings-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Review results</p>
          <h2 id="findings-heading">
            {findings === null ? "Findings" : `${findings.length} ${findings.length === 1 ? "finding" : "findings"}`}
          </h2>
        </div>
        {findings && findings.length > 0 && (
          <span className="finding-count">{highCount} error severity</span>
        )}
      </div>

      {findings === null ? (
        <div className="editor-empty-state">
          <span className="empty-state-mark" aria-hidden="true">✓</span>
          <h3>Your review will appear here</h3>
          <p>Run a review to see guideline, terminology, and approved-fact checks.</p>
        </div>
      ) : findings.length === 0 ? (
        <div className="editor-empty-state success-state" role="status">
          <span className="empty-state-mark" aria-hidden="true">
            {reviewedCustomText ? "i" : "✓"}
          </span>
          <h3>{reviewedCustomText ? "No demo findings for this text" : "No findings"}</h3>
          <p>
            {reviewedCustomText
              ? "The local demo has findings for its sample draft only. This does not mean your custom content has passed a review."
              : "There are no findings to display."}
          </p>
        </div>
      ) : (
        <div className="finding-list">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              id={`finding-card-${finding.id}`}
              finding={finding}
              busy={busyFindingIds.includes(finding.id)}
              selected={selectedFindingId === finding.id}
              onSelect={onSelect}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}
    </section>
  );
}
