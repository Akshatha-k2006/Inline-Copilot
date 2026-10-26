"use client";

import type { Finding, Severity } from "@/lib/types";

interface HighlightedDraftProps {
  body: string;
  findings: Finding[];
  selectedFindingId: number | null;
  onSelect: (finding: Finding) => void;
}

interface FindingSegment {
  finding: Finding;
  start: number;
  end: number;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  high: "Error",
  medium: "Warning",
  low: "Info",
};

function getSegments(body: string, findings: Finding[]): FindingSegment[] {
  const sorted = findings
    .filter(
      (finding) =>
        Number.isInteger(finding.start) &&
        Number.isInteger(finding.end) &&
        finding.start >= 0 &&
        finding.end <= body.length &&
        finding.start < finding.end &&
        body.slice(finding.start, finding.end) === finding.text,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const segments: FindingSegment[] = [];
  let lastEnd = 0;
  for (const finding of sorted) {
    if (finding.start < lastEnd) continue;
    segments.push({ finding, start: finding.start, end: finding.end });
    lastEnd = finding.end;
  }
  return segments;
}

export default function HighlightedDraft({
  body,
  findings,
  selectedFindingId,
  onSelect,
}: HighlightedDraftProps) {
  const segments = getSegments(body, findings);
  let cursor = 0;
  const content = segments.map(({ finding, start, end }) => {
    const before = body.slice(cursor, start);
    cursor = end;
    return (
      <span key={finding.id}>
        {before}
        <button
          id={`draft-highlight-${finding.id}`}
          type="button"
          className={`finding-highlight finding-highlight-${finding.severity}${selectedFindingId === finding.id ? " selected" : ""}`}
          aria-label={`${SEVERITY_LABELS[finding.severity]}: ${finding.check.replaceAll("_", " ")}. ${finding.text}`}
          aria-pressed={selectedFindingId === finding.id}
          onClick={() => onSelect(finding)}
        >{body.slice(start, end)}</button>
      </span>
    );
  });

  return (
    <section className="highlighted-draft" aria-labelledby="highlighted-draft-heading">
      <div className="highlighted-draft-heading">
        <h3 id="highlighted-draft-heading">Highlighted draft</h3>
        <div className="severity-legend" aria-label="Severity key">
          <span><i className="legend-marker legend-error" aria-hidden="true">!</i>Error</span>
          <span><i className="legend-marker legend-warning" aria-hidden="true">!</i>Warning</span>
          <span><i className="legend-marker legend-info" aria-hidden="true">i</i>Info</span>
        </div>
      </div>
      <p className="highlighted-draft-copy">
        Select a highlighted phrase to open its finding. Click a finding to select
        that phrase in the editor.
      </p>
      <div className="highlighted-draft-text">
        {content}
        {body.slice(cursor)}
      </div>
    </section>
  );
}
