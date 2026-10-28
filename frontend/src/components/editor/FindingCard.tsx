"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DemoFinding } from "@/lib/mock-findings";
import { isReplacementSuggestion } from "@/lib/mock-findings";
import type { FindingStatus, Severity } from "@/lib/types";

interface FindingCardProps {
  id: string;
  finding: DemoFinding;
  busy: boolean;
  readOnly?: boolean;
  selected: boolean;
  onSelect: (finding: DemoFinding) => void;
  onResolve?: (
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
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
  readOnly = false,
  selected,
  onSelect,
  onResolve,
}: FindingCardProps) {
  const [editing, setEditing] = useState(false);
  const [suggestion, setSuggestion] = useState(finding.suggestion ?? "");
  const [actionError, setActionError] = useState("");
  const hasSuggestedReplacement = isReplacementSuggestion(finding.suggestion);

  useEffect(() => {
    setSuggestion(hasSuggestedReplacement ? finding.suggestion! : "");
  }, [finding.id, finding.suggestion, hasSuggestedReplacement]);

  async function resolve(
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
  ) {
    if (
      (status === "edited" || (status === "accepted" && finalText !== null)) &&
      !finalText?.trim()
    ) {
      setActionError("Enter a non-empty correction before saving.");
      return;
    }
    if (!onResolve) return;
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
    knowledgeSource?.type === "guideline"
      ? "/knowledge?tab=guidelines"
      : knowledgeSource?.type === "term"
        ? "/knowledge?tab=glossary"
        : "/knowledge?tab=facts";
  const knowledgeLabel =
    knowledgeSource?.type === "guideline"
      ? "View guideline"
      : knowledgeSource?.type === "term"
        ? "View glossary term"
        : "View fact";

  return (
    <article
      id={id}
      className={`finding-card severity-${severity}${selected ? " selected" : ""}`}
      aria-label={`${severityLabel} severity finding: ${checkLabel}`}
      tabIndex={0}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button, a, textarea")) return;
        onSelect(finding);
      }}
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

      <div className="finding-comparison" aria-label="Original and suggested text">
        <section className="finding-comparison-original">
          <h4>Original text</h4>
          <blockquote className="finding-quote">{finding.text}</blockquote>
        </section>
        <section className="finding-comparison-suggestion">
          <h4>Suggested replacement</h4>
          {hasSuggestedReplacement ? (
            <p>{finding.suggestion}</p>
          ) : (
            <p className="muted">
              No replacement text is available for this finding.
              {readOnly
                ? ""
                : " You can edit your own correction, dismiss it, or accept the finding without changing the document text."}
              {readOnly ? "" : " You can enter your own correction."}
            </p>
          )}
        </section>
      </div>
      {finding.explanation && <p className="finding-explanation">{finding.explanation}</p>}
      {finding.source?.label && (
        <p className="finding-source">
          <strong>Source:</strong> {finding.source.label}
        </p>
      )}
      <div className="finding-knowledge-source">
        {knowledgeSource?.type === "guideline" && (
          <p>{knowledgeSource.record.description}</p>
        )}
        {knowledgeSource?.type === "term" && (
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
        {knowledgeSource?.type === "fact" && (
          <p>Approved fact: {knowledgeSource.record.claim}</p>
        )}
        {knowledgeSource && (
          <Link href={knowledgeHref} className="finding-source-link">
            {knowledgeLabel}
          </Link>
        )}
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

      {editing && (
        <div className="finding-suggestion">
          <label htmlFor={`suggestion-${finding.id}`}>Your correction</label>
          <textarea
            id={`suggestion-${finding.id}`}
            value={suggestion}
            onChange={(event) => setSuggestion(event.target.value)}
            rows={3}
            required
          />
        </div>
      )}

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {finding.range_valid === false && finding.status === "open" && (
        <p className="form-error" role="alert">
          This finding overlaps a previous correction. Its text range could not be safely recalculated; dismiss it or run a fresh demo review.
        </p>
      )}
      {resolved ? (
        <p className="finding-resolved-note">This finding is {finding.status}.</p>
      ) : onResolve && !readOnly ? (
        <div className="finding-actions">
          {finding.range_valid === false ? (
            <button
              type="button"
              className="button"
              onClick={() => void resolve("dismissed", null)}
              disabled={busy}
            >
              Dismiss
            </button>
          ) : editing ? (
            <>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void resolve("edited", suggestion)}
                disabled={busy || !suggestion.trim()}
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
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  void resolve(
                    "accepted",
                    hasSuggestedReplacement ? finding.suggestion! : null,
                  )
                }
                aria-label={
                  hasSuggestedReplacement
                    ? "Accept suggested correction"
                    : "Accept finding without changing document text"
                }
                disabled={busy}
              >
                Accept
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSuggestion(hasSuggestedReplacement ? finding.suggestion! : "");
                  setEditing(true);
                }}
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
      ) : (
        <p className="finding-resolved-note">Finding actions are unavailable in this role.</p>
      )}
    </article>
  );
}
