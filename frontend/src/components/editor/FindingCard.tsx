"use client";

import { useState } from "react";
import type { Finding, FindingStatus, Severity } from "@/lib/types";

interface FindingCardProps {
  finding: Finding;
  busy: boolean;
  onResolve: (
    finding: Finding,
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
  finding,
  busy,
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

  return (
    <article className={`finding-card severity-${severity}`} aria-label={`${severityLabel} severity finding`}>
      <div className="finding-heading">
        <div>
          <span className={`severity-badge severity-badge-${severity}`}>
            {severityLabel} severity
          </span>
          <h3>{finding.check.replaceAll("_", " ")}</h3>
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
        <p className="finding-resolved-note">This finding has been {finding.status}.</p>
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
