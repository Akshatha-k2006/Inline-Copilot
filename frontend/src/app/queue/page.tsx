"use client";

import { useState } from "react";
import FindingsPanel from "@/components/editor/FindingsPanel";
import {
  addDemoReviewComment,
  formatMockTimestamp,
  getDocumentFindings,
  getQueuedDocuments,
  MOCK_DATA_NOTICE,
  transitionDemoDocument,
  useDemoWorkspace,
} from "@/lib/mock-data";
import { useRole } from "@/lib/role";
import {
  canDecideReview,
  canViewReviewQueue,
  contentStatusLabel,
  getSubmissionBlockers,
  reviewIsCurrent,
} from "@/lib/workflow";

export default function ReviewQueuePage() {
  const workspace = useDemoWorkspace();
  const { role, user } = useRole();
  const documents = getQueuedDocuments(workspace);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mayDecide = canDecideReview(role);
  const selectedDocument = documents.find(
    (document) => document.id === selectedDocumentId,
  );

  function addComment(documentId: number) {
    setError("");
    setMessage("");
    setBusy(true);
    try {
      addDemoReviewComment(documentId, role, user, comment);
      setComment("");
      setMessage("Review comment added to the shared demonstration history.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this comment.");
    } finally {
      setBusy(false);
    }
  }

  function decide(action: "approve" | "request_changes") {
    if (!selectedDocument) return;
    setError("");
    setMessage("");
    setBusy(true);
    try {
      transitionDemoDocument(
        selectedDocument.id,
        action,
        role,
        user,
        comment,
      );
      setComment("");
      setSelectedDocumentId(null);
      setMessage(
        action === "approve"
          ? "Content approved and marked Ready to publish."
          : "Changes requested. The creator can revise and resubmit the draft.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete this review action.");
    } finally {
      setBusy(false);
    }
  }

  if (!canViewReviewQueue(role)) {
    return (
      <section className="page">
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Review queue</h1>
        <p className="mock-data-notice" role="note">{MOCK_DATA_NOTICE}</p>
        <p className="editor-notice" role="status">
          The review queue is available to Reviewer, Brand Manager, and Admin demo roles. Switch roles in the top navigation to continue.
        </p>
      </section>
    );
  }

  return (
    <section className="page">
      <div>
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Review queue</h1>
        <p className="lead">Submitted demonstration content awaiting a human decision.</p>
      </div>
      <p className="mock-data-notice" role="note">{MOCK_DATA_NOTICE} Role switching is a prototype, not authentication.</p>
      {message && <p className="editor-notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {documents.length === 0 ? (
        <div className="card">
          <h2>No documents in the demonstration queue</h2>
          <p className="muted">Only documents with In Review status appear here. Submitted content and decisions are local mock data.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {documents.map((document) => {
            const findings = getDocumentFindings(workspace, document.id);
            const openCount = findings.filter(
              (finding) => finding.status === "open",
            ).length;
            const review = workspace.reviews.find(
              (item) => item.document_id === document.id,
            );
            const currentReview = reviewIsCurrent(document, review);
            const blockers = getSubmissionBlockers(document, review, findings);
            const selected = selectedDocumentId === document.id;
            const comments = workspace.comments.filter(
              (item) => item.document_id === document.id,
            );
            const submissions = workspace.submissions.filter(
              (item) => item.document_id === document.id,
            );
            const previousSubmission =
              submissions.length > 1
                ? submissions[submissions.length - 2]
                : undefined;
            const severityCounts = (["high", "medium", "low"] as const).map(
              (severity) => ({
                severity,
                count: findings.filter(
                  (finding) =>
                    finding.severity === severity && finding.status === "open",
                ).length,
              }),
            );

            return (
              <li className="entry-card mock-document-card" key={document.id}>
                <div className="entry-content">
                  <p className="eyebrow">Document #{document.id}</p>
                  <h2>{document.title}</h2>
                  <p className="mock-document-preview">{document.body}</p>
                  <div className="fact-meta">
                    <span>
                      Status: <strong>{contentStatusLabel(document.status)}</strong>
                    </span>
                    <span>Version: <strong>{document.version}</strong></span>
                    <span>Open findings: <strong>{openCount}</strong></span>
                    {severityCounts.map(({ severity, count }) => (
                      <span key={severity}>
                        {severity}: <strong>{count}</strong>
                      </span>
                    ))}
                  </div>
                  <p className="muted">
                    Updated {formatMockTimestamp(document.updated_at)} · Created by {document.created_by}
                  </p>
                </div>
                <div className="entry-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    aria-expanded={selected}
                    aria-controls={`review-details-${document.id}`}
                    onClick={() => {
                      setSelectedDocumentId(selected ? null : document.id);
                      setError("");
                    }}
                  >
                    {selected ? "Close review" : "Open review"}
                  </button>
                </div>
                {selected && (
                  <section
                    id={`review-details-${document.id}`}
                    className="review-detail"
                    aria-labelledby={`review-detail-heading-${document.id}`}
                  >
                    <div>
                      <h3 id={`review-detail-heading-${document.id}`}>Content for review</h3>
                      {previousSubmission && (
                        <section className="review-version-comparison" aria-labelledby={`version-comparison-heading-${document.id}`}>
                          <h4 id={`version-comparison-heading-${document.id}`}>
                            Changes since the previous submission
                          </h4>
                          <div>
                            <section>
                              <h5>Previous submission · version {previousSubmission.version}</h5>
                              <pre className="review-document-body">{previousSubmission.body}</pre>
                            </section>
                            <section>
                              <h5>Current submission · version {document.version}</h5>
                              {!previousSubmission && (
                                <pre className="review-document-body">{document.body}</pre>
                              )}
                            </section>
                          </div>
                        </section>
                      )}
                      {!previousSubmission && (
                        <p className="muted">This is the first submission; there is no earlier submitted version to compare.</p>
                      )}
                      <pre className="review-document-body">{document.body}</pre>
                      <p className="editor-notice">
                        {currentReview
                          ? "The mock review matches this document version. It checks only known demonstration phrases, not every guideline or fact."
                          : "This review is stale or missing. The creator must rerun the demonstration checks before submission."}
                      </p>
                    </div>
                    <FindingsPanel
                      findings={
                        workspace.findingsBody === document.body ? findings : null
                      }
                      busyFindingIds={findings.map((finding) => finding.id)}
                      readOnly
                      selectedFindingId={null}
                      reviewedCustomText={document.body !== workspace.findingsBody}
                      onSelect={() => undefined}
                    />

                    <section className="workflow-comments" aria-labelledby={`comments-heading-${document.id}`}>
                      <h3 id={`comments-heading-${document.id}`}>Review comments</h3>
                      {comments.length === 0 ? (
                        <p className="muted">No review comments have been added.</p>
                      ) : (
                        <ul>
                          {comments.map((item) => (
                            <li key={item.id}>
                              <p>{item.text}</p>
                              <small>{item.author} · {item.role.replaceAll("_", " ")} · {formatMockTimestamp(item.at)}</small>
                            </li>
                          ))}
                        </ul>
                      )}
                      {mayDecide && (
                        <label className="form-field" htmlFor={`review-comment-${document.id}`}>
                          Review comment (required for Request changes)
                          <textarea
                            id={`review-comment-${document.id}`}
                            value={comment}
                            onChange={(event) => setComment(event.target.value)}
                            rows={3}
                            disabled={busy}
                          />
                        </label>
                      )}
                    </section>

                    {mayDecide ? (
                      <>
                        {blockers.length > 0 && (
                          <ul className="workflow-blockers" aria-label="Approval blockers">
                            {blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                          </ul>
                        )}
                        <div className="workflow-actions">
                          <button
                            type="button"
                            className="button button-primary"
                            onClick={() => decide("approve")}
                            disabled={busy || blockers.length > 0}
                            title={blockers.length > 0 ? blockers.join(" ") : undefined}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => decide("request_changes")}
                            disabled={busy || comment.trim().length < 10}
                            title={comment.trim().length < 10 ? "Add a meaningful comment of at least 10 characters." : undefined}
                          >
                            Request changes
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => addComment(document.id)}
                            disabled={busy || comment.trim().length < 3}
                          >
                            Add comment
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="editor-notice" role="note">
                        {role === "brand_manager"
                          ? "Brand Manager can inspect compliance and sources but cannot make reviewer decisions."
                          : "Admin can inspect workflow records but cannot bypass the required reviewer decision."}
                      </p>
                    )}
                  </section>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
