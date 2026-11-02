"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DemoFinding } from "@/lib/findings";
import { isReplacementSuggestion } from "@/lib/findings";
import { ROLE_OPTIONS } from "@/lib/roles";
import type { EvidenceRequest, FindingStatus, Severity } from "@/lib/types";

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
  onRecheck?: (finding: DemoFinding) => Promise<void>;
  onEditAccessibility?: (finding: DemoFinding) => void;
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
  evidenceRequests = [],
  evidenceLoading = false,
  evidenceError = "",
  onRequestEvidence,
  onRecheck,
  onEditAccessibility,
}: FindingCardProps) {
  const [editing, setEditing] = useState(false);
  const [suggestion, setSuggestion] = useState(finding.suggestion ?? "");
  const [dismissalReason, setDismissalReason] = useState("");
  const [showDismissal, setShowDismissal] = useState(false);
  const [actionError, setActionError] = useState("");
  const [showEvidenceForm, setShowEvidenceForm] = useState(false);
  const [evidenceReason, setEvidenceReason] = useState("");
  const [evidenceAssignee, setEvidenceAssignee] = useState("");
  const [evidenceSubmitting, setEvidenceSubmitting] = useState(false);
  const [evidenceFormError, setEvidenceFormError] = useState("");
  const [evidenceSuccess, setEvidenceSuccess] = useState("");
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
    if (status === "dismissed" && !dismissalReason.trim()) {
      setActionError("Choose a dismissal reason before continuing.");
      return;
    }
    if (!onResolve) return;
    setActionError("");
    try {
      await onResolve(finding, status, finalText, dismissalReason);
      setEditing(false);
      setShowDismissal(false);
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
  const isAccessibility = finding.check === "accessibility";
  const checkLabel =
    finding.check === "accessibility"
      ? finding.accessibility?.image_filename
        ? "Missing alt text"
        : "Color contrast"
      : String(finding.check ?? "Unknown").replaceAll("_", " ");
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
  const canRequestEvidence =
    finding.check === "unsupported_claim" && Boolean(onRequestEvidence);
  const hasOpenEvidenceRequest = evidenceRequests.some(
    (request) => request.status === "open",
  );

  async function requestEvidence() {
    const reason = evidenceReason.trim();
    if (!finding.id || !finding.text.trim()) {
      setEvidenceFormError("This finding does not have a valid claim reference.");
      return;
    }
    if (!reason) {
      setEvidenceFormError("Enter a reason for requesting evidence.");
      return;
    }
    if (!evidenceAssignee) {
      setEvidenceFormError("Choose an owner for this request.");
      return;
    }
    if (!onRequestEvidence) return;
    setEvidenceFormError("");
    setEvidenceSubmitting(true);
    try {
      await onRequestEvidence(finding, reason, evidenceAssignee);
      setEvidenceReason("");
      setEvidenceAssignee("");
      setShowEvidenceForm(false);
      setEvidenceSuccess("Evidence request created successfully.");
    } catch (error) {
      setEvidenceFormError(
        error instanceof Error
          ? error.message
          : "Could not create the evidence request. Please try again.",
      );
    } finally {
      setEvidenceSubmitting(false);
    }
  }

  return (
    <article
      id={id}
      className={`finding-card severity-${severity}${selected ? " selected" : ""}`}
      aria-label={`${severityLabel} severity finding: ${checkLabel}`}
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "button, a, textarea, summary, select, input, label, option",
          )
        )
          return;
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
          <h3>{isAccessibility ? `Accessibility · ${checkLabel}` : checkLabel}</h3>
        </div>
        <span
          className={`finding-status status-${finding.status ?? "unknown"}`}
        >
          {String(finding.status ?? "Unknown").replaceAll("_", " ")}
        </span>
      </div>

      <div
        className="finding-comparison"
        aria-label="Original and suggested text"
      >
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
      {isAccessibility && finding.accessibility?.image_filename && (
        <p className="finding-source">
          <strong>Affected image:</strong> {finding.accessibility.image_filename}
        </p>
      )}
      {isAccessibility && finding.accessibility?.contrast_ratio !== undefined && (
        <dl className="finding-fact-details accessibility-contrast-details">
          <div>
            <dt>Affected text</dt>
            <dd>{finding.text}</dd>
          </div>
          <div>
            <dt>Colors</dt>
            <dd>
              {finding.accessibility.foreground_color} on{" "}
              {finding.accessibility.background_color}
            </dd>
          </div>
          <div>
            <dt>Contrast</dt>
            <dd>
              {finding.accessibility.contrast_ratio.toFixed(2)}:1 required{" "}
              {finding.accessibility.required_ratio?.toFixed(1)}:1
            </dd>
          </div>
        </dl>
      )}
      {finding.explanation && (
        <p className="finding-explanation">{finding.explanation}</p>
      )}
      {finding.source?.label && (
        <p className="finding-source">
          <strong>Source:</strong> {finding.source.label}
        </p>
      )}
      <details className="finding-details">
        <summary>Knowledge details</summary>
        <div className="finding-context">
          <div className="finding-knowledge-source">
            {knowledgeSource.type === "guideline" && (
              <p>{knowledgeSource.record.description}</p>
            )}
            {knowledgeSource.type === "term" && (
              <>
                <p>{knowledgeSource.record.definition}</p>
                <p>
                  Status:{" "}
                  <strong>
                    {knowledgeSource.record.status ?? "unspecified"}
                  </strong>
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
        </div>
      </details>

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

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {isAccessibility && !readOnly && onRecheck && (
        <div className="finding-actions">
          {finding.accessibility?.image_id && onEditAccessibility && (
            <button
              type="button"
              className="button"
              onClick={() => onEditAccessibility(finding)}
            >
              Edit alt text
            </button>
          )}
          <button
            type="button"
            className="button button-primary"
            onClick={() => void onRecheck(finding)}
            disabled={busy}
          >
            {busy ? "Rechecking..." : "Recheck"}
          </button>
        </div>
      )}
      {canRequestEvidence && (
        <div className="evidence-request">
          {evidenceLoading ? (
            <p className="muted" role="status">Loading evidence requests...</p>
          ) : evidenceError ? (
            <p className="form-error" role="alert">{evidenceError}</p>
          ) : evidenceRequests.length > 0 ? (
            <div className="evidence-request-list" aria-label="Evidence requests">
              {evidenceRequests.map((request) => (
                <p key={request.id} className="evidence-request-status">
                  Evidence request: <strong>{request.status}</strong> · Owner:{" "}
                  <strong>{request.assignee}</strong>
                </p>
              ))}
            </div>
          ) : (
            <p className="muted">No evidence requests yet.</p>
          )}
          {evidenceSuccess && (
            <p className="form-success" role="status">
              {evidenceSuccess}
            </p>
          )}
          {!showEvidenceForm ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setEvidenceFormError("");
                setEvidenceSuccess("");
                setEvidenceReason(
                  `Provide approved evidence to support this claim before it can be published: "${finding.text}".`,
                );
                setShowEvidenceForm(true);
              }}
              disabled={
                evidenceSubmitting || evidenceLoading || hasOpenEvidenceRequest
              }
            >
              {hasOpenEvidenceRequest ? "Evidence Requested" : "Request Evidence"}
            </button>
          ) : (
            <div
              className="evidence-request-form"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="form-field">
                <label htmlFor={`evidence-claim-${finding.id}`}>Claim text</label>
                <input
                  id={`evidence-claim-${finding.id}`}
                  value={finding.text}
                  readOnly
                />
              </div>
              <div className="form-field">
                <label htmlFor={`evidence-reason-${finding.id}`}>Reason</label>
                <textarea
                  id={`evidence-reason-${finding.id}`}
                  value={evidenceReason}
                  onChange={(event) => setEvidenceReason(event.target.value)}
                  rows={3}
                  aria-describedby={
                    evidenceFormError ? `evidence-error-${finding.id}` : undefined
                  }
                />
              </div>
              <div className="form-field">
                <label htmlFor={`evidence-owner-${finding.id}`}>Assigned owner</label>
                <select
                  id={`evidence-owner-${finding.id}`}
                  value={evidenceAssignee}
                  onChange={(event) => setEvidenceAssignee(event.target.value)}
                >
                  <option value="">Choose an owner</option>
                  {ROLE_OPTIONS.filter((option) => option.role !== "creator").map(
                    (option) => (
                      <option key={option.user} value={option.user}>
                        {option.user}
                      </option>
                    ),
                  )}
                </select>
              </div>
              {evidenceFormError && (
                <p id={`evidence-error-${finding.id}`} className="form-error" role="alert">
                  {evidenceFormError}
                </p>
              )}
              <div className="finding-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void requestEvidence()}
                  disabled={evidenceSubmitting}
                >
                  {evidenceSubmitting ? "Submitting..." : "Submit request"}
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setShowEvidenceForm(false);
                    setEvidenceFormError("");
                  }}
                  disabled={evidenceSubmitting}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {finding.range_valid === false && finding.status === "open" && (
        <p className="form-error" role="alert">
          This finding overlaps a previous correction. Its text range could not
          be safely recalculated; dismiss it or run a fresh demo review.
        </p>
      )}
      {resolved ? (
        <p className="finding-resolved-note">
          This finding is {finding.status}.
        </p>
      ) : onResolve && !readOnly ? (
        <div className="finding-actions">
          {finding.range_valid === false ? (
            <button
              type="button"
              className="button"
              onClick={() => setShowDismissal(true)}
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
              {hasSuggestedReplacement && (
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void resolve("accepted", finding.suggestion!)}
                  aria-label="Accept suggested correction"
                  disabled={busy}
                >
                  Accept
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => {
                  setSuggestion(
                    hasSuggestedReplacement ? finding.suggestion! : "",
                  );
                  setEditing(true);
                }}
                disabled={busy}
              >
                Edit
              </button>
              <button
                type="button"
                className="button"
                onClick={() => setShowDismissal(true)}
                disabled={busy}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      ) : (
        <p className="finding-resolved-note">
          Finding actions are unavailable in this role.
        </p>
      )}
      {showDismissal && !resolved && !readOnly && (
        <div className="dismissal-form">
          <label htmlFor={`dismissal-reason-${finding.id}`}>
            Why is this not applicable?
          </label>
          <select
            id={`dismissal-reason-${finding.id}`}
            value={dismissalReason}
            onChange={(event) => setDismissalReason(event.target.value)}
          >
            <option value="">Choose a reason</option>
            <option value="Not applicable">Not applicable</option>
            <option value="Context explains the claim">
              Context explains the claim
            </option>
            <option value="Approved exception">Approved exception</option>
            <option value="False positive">False positive</option>
          </select>
          <div className="finding-actions">
            <button
              type="button"
              className="button button-danger"
              onClick={() => void resolve("dismissed", null)}
              disabled={busy || !dismissalReason}
            >
              Confirm dismissal
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setShowDismissal(false);
                setDismissalReason("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
