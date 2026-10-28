"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import EmptyState from "@/components/EmptyState";
import { useRole } from "@/lib/role";
import {
  addDemoReviewComment,
  formatMockTimestamp,
  getDocumentFindings,
  getQueuedDocuments,
  transitionDemoDocument,
  useDemoWorkspace,
} from "@/lib/mock-data";
import { canViewReviewQueue, contentStatusLabel } from "@/lib/workflow";

export default function ReviewQueuePage() {
  const { role, user } = useRole();
  const workspace = useDemoWorkspace();
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const queued = useMemo(() => getQueuedDocuments(workspace), [workspace]);

  if (!canViewReviewQueue(role))
    return (
      <section className="page">
        <EmptyState
          title="Review queue is for reviewers"
          description="Creators can prepare drafts in the Inline Editor."
          action={
            <Link className="button button-primary" href="/editor">
              Open editor
            </Link>
          }
        />
      </section>
    );

  function updateFeedback(id: number, value: string) {
    setFeedback((current) => ({ ...current, [id]: value }));
  }

  function runAction(
    id: number,
    action: "comment" | "request_changes" | "approve",
  ) {
    const text = feedback[id]?.trim() ?? "";
    if (action === "comment" && text.length < 3) {
      setMessage({
        kind: "error",
        text: "Enter at least 3 characters before saving a note.",
      });
      return;
    }
    if (action === "request_changes" && text.length < 10) {
      setMessage({
        kind: "error",
        text: "Explain the requested changes in at least 10 characters.",
      });
      return;
    }
    if (
      action === "approve" &&
      !window.confirm(
        "Approve this draft? It will be marked ready to publish in the demo workflow.",
      )
    )
      return;

    setBusy(id);
    setMessage(null);
    try {
      if (action === "comment") {
        addDemoReviewComment(id, role, user, text);
        setFeedback((current) => ({ ...current, [id]: "" }));
        setMessage({
          kind: "success",
          text: "Note saved to the review history.",
        });
      } else {
        transitionDemoDocument(id, action, role, user, text);
        setFeedback((current) => ({ ...current, [id]: "" }));
        setMessage({
          kind: "success",
          text:
            action === "approve"
              ? "Draft approved and marked ready to publish. No external publication was performed."
              : "Changes requested. The creator can update and resubmit this draft.",
        });
      }
    } catch (cause) {
      setMessage({
        kind: "error",
        text:
          cause instanceof Error
            ? cause.message
            : "The review action could not be completed.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page review-queue-page">
      <header className="review-queue-header">
        <div>
          <p className="eyebrow">CoRESpace / Review Queue</p>
          <h1>Review submitted work</h1>
          <p className="lead">
            Inspect content, review evidence, and make an accountable human
            decision.
          </p>
        </div>
      </header>

      {message && (
        <p
          className={
            message.kind === "error" ? "editor-error" : "editor-notice"
          }
          role="status"
        >
          {message.text}
        </p>
      )}

      {queued.length === 0 ? (
        <EmptyState
          title="No documents are waiting for review"
          description="Submit a reviewed draft as the Creator role to see it here."
          action={
            <Link className="button button-primary" href="/editor">
              Open editor
            </Link>
          }
        />
      ) : (
        <div className="review-queue-list" aria-label="Submitted documents">
          {queued.map((document) => {
            const findings = getDocumentFindings(workspace, document.id);
            const openFindings = findings.filter(
              (finding) => finding.status === "open",
            ).length;
            const resolvedFindings = findings.length - openFindings;
            const isExpanded = Boolean(expanded[document.id]);
            const isBusy = busy === document.id;
            const comments = workspace.comments.filter(
              (comment) => comment.document_id === document.id,
            );
            return (
              <article className="review-queue-card" key={document.id}>
                <div className="review-queue-card-main">
                  <div className="review-queue-card-heading">
                    <div>
                      <p className="eyebrow">
                        Submitted {formatMockTimestamp(document.updated_at)}
                      </p>
                      <h2>{document.title || "Untitled document"}</h2>
                    </div>
                    <span className="content-status status-in_review">
                      {contentStatusLabel(document.status)}
                    </span>
                  </div>
                  <p className="review-queue-meta">
                    <span>
                      Creator: {document.created_by || "Unknown creator"}
                    </span>
                    <span
                      aria-label={`${openFindings} open and ${resolvedFindings} resolved findings`}
                    >
                      {findings.length === 0
                        ? "Findings not loaded"
                        : `${openFindings} open · ${resolvedFindings} resolved`}
                    </span>
                  </p>
                  <p className="review-queue-excerpt">
                    {document.body.slice(0, 240)}
                    {document.body.length > 240 ? "…" : ""}
                  </p>
                </div>
                <div className="review-queue-actions">
                  <Link className="button" href={`/editor?id=${document.id}`}>
                    Inspect draft
                  </Link>
                  <button
                    className="button"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={`feedback-${document.id}`}
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [document.id]: !isExpanded,
                      }))
                    }
                  >
                    {isExpanded
                      ? "Hide feedback"
                      : `Feedback${comments.length ? ` (${comments.length})` : ""}`}
                  </button>
                </div>
                {isExpanded && (
                  <div
                    className="review-feedback"
                    id={`feedback-${document.id}`}
                  >
                    {comments.length > 0 && (
                      <div
                        className="review-feedback-history"
                        aria-label="Saved review notes"
                      >
                        {comments.map((comment) => (
                          <p key={comment.id}>
                            <strong>{comment.author}</strong>
                            <span>{comment.text}</span>
                            <small>{formatMockTimestamp(comment.at)}</small>
                          </p>
                        ))}
                      </div>
                    )}
                    <label
                      className="form-field"
                      htmlFor={`feedback-input-${document.id}`}
                    >
                      <span>Feedback or decision reason</span>
                      <textarea
                        id={`feedback-input-${document.id}`}
                        rows={3}
                        value={feedback[document.id] ?? ""}
                        onChange={(event) =>
                          updateFeedback(document.id, event.target.value)
                        }
                        placeholder="Share evidence or explain the requested changes."
                      />
                    </label>
                    <div className="review-feedback-actions">
                      <button
                        className="button"
                        type="button"
                        disabled={isBusy}
                        onClick={() => runAction(document.id, "comment")}
                      >
                        {isBusy ? "Saving..." : "Save note"}
                      </button>
                      <button
                        className="button button-danger"
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          runAction(document.id, "request_changes")
                        }
                      >
                        Request changes
                      </button>
                      <button
                        className="button button-primary"
                        type="button"
                        disabled={isBusy}
                        onClick={() => runAction(document.id, "approve")}
                      >
                        {isBusy ? "Processing..." : "Approve & publish"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
