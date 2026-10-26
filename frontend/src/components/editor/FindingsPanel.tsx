"use client";

import type { Finding, FindingStatus } from "@/lib/types";
import FindingCard from "./FindingCard";

interface FindingsPanelProps {
  findings: Finding[] | null;
  busyFindingIds: number[];
  onResolve: (
    finding: Finding,
    status: FindingStatus,
    finalText: string | null,
  ) => Promise<void>;
}

export default function FindingsPanel({
  findings,
  busyFindingIds,
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
          <span className="finding-count">{highCount} high priority</span>
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
          <span className="empty-state-mark" aria-hidden="true">✓</span>
          <h3>No issues found</h3>
          <p>Your content passed the available brand checks.</p>
        </div>
      ) : (
        <div className="finding-list">
          {findings.map((finding) => (
            <FindingCard
              key={finding.id}
              finding={finding}
              busy={busyFindingIds.includes(finding.id)}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}
    </section>
  );
}
