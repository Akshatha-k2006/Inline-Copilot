"use client";

import Link from "next/link";
import { useState } from "react";
import type { DemoFinding } from "@/lib/mock-findings";
import type { FindingStatus, Severity } from "@/lib/types";

interface FindingCardProps {
  id: string;
  finding: DemoFinding;
  busy: boolean;
  selected: boolean;
  onSelect: (finding: DemoFinding) => void;
  onResolve: (
    finding: DemoFinding,
    status: FindingStatus,
    finalText: string | null,
  ) => Promise<void>;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

export default function FindingCard({
  id,
  finding,
  busy,
  selected,
  onSelect,
  onResolve,
}: FindingCardProps) {
  const [editing, setEditing] = useState(false);
  const [suggestion, setSuggestion] = useState(finding.suggestion ?? "");
  const [actionError, setActionError] = useState("");

  async function resolve(status: FindingStatus, finalText: string | null) {
    setActionError("");
    try {
      await onResolve(finding, status, finalText);
      setEditing(false);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Could not update this finding. Please try again.",
      );
    }
  }

  const severity = finding.severity;
  const severityLabel = SEVERITY_LABELS[severity] ?? "Unspecified";
  const resolved = finding.status !== "open";
  const checkLabel = finding.check.replaceAll("_", " ");
  const knowledgeSource = finding.knowledge_source;
  const knowledgeHref =
    knowledgeSource.type === "guideline"
      ? "/knowledge?tab=guidelines"
      : knowledgeSource.type === "term"
        ? "/knowledge?tab=glossary"
        : "/knowledge?tab=facts";
  const knowledgeLabel =
    knowledgeSource.type === "guideline"
      ? "View guideline"
      : knowledgeSource.type === "term"
        ? "View glossary term"
        : "View fact";

  return (
    <article
      id={id}
      className={`finding-card severity-${severity}${selected ? " selected" : ""}`}
      aria-label={`${severityLabel} severity finding: ${checkLabel}`}
      tabIndex={0}
      onClick={() => onSelect(finding)}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          onSelect(finding);
        }
      }}
    >
      <div className="finding-heading">
        <div>
          <span className={`severity-badge severity-badge-${severity}`}>
            {severityLabel} · {severity} severity
          </span>
          <h3>{checkLabel}</h3>
        </div>
        <span className={`finding-status status-${finding.status}`}>
          {finding.status.replaceAll("_", " ")}
        </span>
      </div>

      {finding.text && (
        <blockquote className="finding-quote">{finding.text}</blockquote>
      )}
      {finding.explanation && <p className="finding-explanation">{finding.explanation}</p>}
      {finding.source?.label && (
        <p className="finding-source">
          <strong>Source:</strong> {finding.source.label}
        </p>
      )}
      <div className="finding-knowledge-source">
        {knowledgeSource.type === "guideline" && (
          <p>{knowledgeSource.record.description}</p>
        )}
        {knowledgeSource.type === "term" && (
          <>
            <p>{knowledgeSource.record.definition}</p>
            <p>
              Status: <strong>{knowledgeSource.record.status ?? "unspecified"}</strong>
              {knowledgeSource.record.preferredTerm
                ? ` · Preferred wording: ${knowledgeSource.record.preferredTerm}`
                : ""}
            </p>
          </>
        )}
        {knowledgeSource.type === "fact" && (
          <p>Current mock fact: {knowledgeSource.record.claim}</p>
        )}
        <Link href={knowledgeHref} className="finding-source-link">
          {knowledgeLabel}
        </Link>
      </div>
      {finding.fact_details && (
        <dl className="finding-fact-details">
          {finding.fact_details.source && (
            <div>
              <dt>Mock source reference</dt>
              <dd>{finding.fact_details.source}</dd>
            </div>
          )}
          <div>
            <dt>Fact owner</dt>
            <dd>{finding.fact_details.owner}</dd>
          </div>
          {finding.fact_details.last_reviewed && (
            <div>
              <dt>Last reviewed</dt>
              <dd>{finding.fact_details.last_reviewed}</dd>
            </div>
          )}
          <div>
            <dt>Review by</dt>
            <dd>{finding.fact_details.review_date}</dd>
          </div>
        </dl>
      )}

      {(finding.suggestion || editing) && (
        <div className="finding-suggestion">
          <strong>Suggested fix</strong>
          {editing ? (
            <label className="sr-only" htmlFor={`suggestion-${finding.id}`}>
              Edit suggested fix
            </label>
          ) : null}
          {editing ? (
            <textarea
              id={`suggestion-${finding.id}`}
              value={suggestion}
              onChange={(event) => setSuggestion(event.target.value)}
              rows={3}
            />
          ) : (
            <p>{finding.final_text ?? finding.suggestion}</p>
          )}
        </div>
      )}

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {resolved ? (
        <p className="finding-resolved-note">
          This finding is {finding.status}. Demo changes are not saved.
        </p>
      ) : (
        <div className="finding-actions">
          {editing ? (
            <>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void resolve("edited", suggestion)}
                disabled={busy}
              >
                Save edit
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSuggestion(finding.suggestion ?? "");
                  setEditing(false);
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {finding.suggestion && (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void resolve("accepted", finding.suggestion ?? null)}
                  disabled={busy}
                >
                  Accept
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => setEditing(true)}
                disabled={busy}
              >
                Edit
              </button>
              <button
                type="button"
                className="button"
                onClick={() => void resolve("dismissed", null)}
                disabled={busy}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}
