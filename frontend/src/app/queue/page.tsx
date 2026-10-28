"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import EmptyState from "@/components/EmptyState";
import { ApiError, api } from "@/lib/api";
import { useRole } from "@/lib/role";
import type {
  BackendFinding,
  Content,
  ContentAuditEvent,
  ReviewComment,
} from "@/lib/types";
import { canDecideReview, canViewReviewQueue, contentStatusLabel } from "@/lib/workflow";

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export default function ReviewQueuePage() {
  const { role, user, isRoleLoaded } = useRole();
  const [documents, setDocuments] = useState<Content[]>([]);
  const [allDocuments, setAllDocuments] = useState<Content[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Content | null>(null);
  const [findings, setFindings] = useState<BackendFinding[]>([]);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [auditEvents, setAuditEvents] = useState<ContentAuditEvent[]>([]);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const actionInFlight = useRef(false);
  const contentLoadId = useRef(0);
  const mayView = canViewReviewQueue(role);
  const mayDecide = canDecideReview(role);

  const refreshContent = useCallback(async (id: number) => {
    const requestId = ++contentLoadId.current;
    const [current, findingsResponse, commentsResponse, auditResponse] =
      await Promise.all([
        api.getContent(id),
        api.getContentFindings(id),
        api.getReviewComments(id),
        api.getContentAudit(id),
      ]);
    if (requestId !== contentLoadId.current) return;
    setSelected(current);
    setFindings(findingsResponse.findings);
    setComments(commentsResponse.comments);
    setAuditEvents(auditResponse);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.listContent();
      setAllDocuments(all);
      const queue = all.filter((content) => content.status === "in_review");
      setDocuments(queue);
      if (selectedId !== null) {
        await refreshContent(selectedId);
      }
      setError("");
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, [refreshContent, selectedId]);

  useEffect(() => {
    if (isRoleLoaded) void reload();
  }, [isRoleLoaded, role, reload]);

  async function perform(action: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  function openReview(id: number) {
    setSelectedId(id);
    const target = documents.find((item) => item.id === id);
    setSelected(target ?? null);
    if (target) void refreshContent(id).catch((cause: unknown) => setError(messageFor(cause)));
  }

  async function addComment() {
    if (!selected) return;
    await perform(async () => {
      await api.addReviewComment(selected.id, { body: comment });
      setComment("");
      await reload();
      setMessage("Comment saved to the backend.");
    });
  }

  async function decide(decision: "approve" | "request_changes") {
    if (!selected) return;
    await perform(async () => {
      await api.decideContent(selected.id, {
        decision,
        ...(decision === "request_changes" ? { comment } : {}),
      });
      setComment("");
      await reload();
      setMessage(decision === "approve" ? "Content approved." : "Changes requested; content returned to draft.");
    });
  }

  async function markReady(id: number) {
    await perform(async () => {
      await api.markReadyToPublish(id);
      setSelectedId(id);
      await refreshContent(id);
      await reload();
      setMessage("Content marked ready to publish.");
    });
  }

  if (!mayView) {
    return (
      <section className="page">
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Review queue</h1>
        <EmptyState
          title="The review queue is not available to this role"
          description="Creators can prepare and submit their own content in Write & Review."
          action={<Link href="/editor" className="button button-primary">Open Write &amp; Review</Link>}
        />
      </section>
    );
  }

  return (
    <section className="page">
      <div>
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Review queue</h1>
        <p className="lead">Content in this queue is loaded from the backend database.</p>
      </div>
      {error && <div className="form-error" role="alert"><p>{error}</p><button className="button" type="button" onClick={() => void reload()}>Retry</button></div>}
      {message && <p className="editor-notice" role="status">{message}</p>}
      {loading ? (
        <p className="editor-notice" role="status">Loading submitted content from the backend...</p>
      ) : documents.length === 0 ? (
        <EmptyState
          title="No content is waiting for review"
          description="New submissions appear here after a creator runs the backend review and submits a draft."
          action={<Link href="/editor" className="button button-primary">Open content</Link>}
        />
      ) : (
        <ul className="entry-list">
          {documents.map((document) => {
            const isSelected = selectedId === document.id;
            const documentFindings = isSelected ? findings : [];
            const openHigh = documentFindings.filter((item) => item.status === "open" && item.severity === "high");
            return (
              <li className="entry-card" key={document.id}>
                <div className="entry-content">
                  <p className="eyebrow">Content #{document.id}</p>
                  <h2>{document.title}</h2>
                  <div className="fact-meta">
                    <span>Status: <strong>{contentStatusLabel(document.status)}</strong></span>
                    <span>Version: <strong>{document.version}</strong></span>
                    <span>Created by: <strong>{document.created_by}</strong></span>
                  </div>
                </div>
                <div className="entry-actions">
                  <button type="button" className="button button-primary" onClick={() => openReview(document.id)}>
                    {isSelected ? "Refresh review" : "Inspect content"}
                  </button>
                </div>
                {isSelected && selected && (
                  <section className="review-detail" aria-label="Submitted content details">
                    <h3>Content for review · version {selected.version}</h3>
                    <pre className="review-document-body">{selected.body}</pre>
                    <h3>Persisted findings</h3>
                    {findings.length === 0 ? <p className="muted">No findings are recorded.</p> : (
                      <ul className="finding-list">
                        {findings.map((item) => (
                          <li className="finding-card" key={item.id}>
                            <strong>{item.severity} · {item.check.replaceAll("_", " ")}</strong>
                            <span className={`finding-status status-${item.status}`}>{item.status}</span>
                            <p>{item.message}</p>
                            {item.evidence?.matched_text && <q>{item.evidence.matched_text}</q>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <section className="workflow-comments">
                      <h3>Persisted review comments</h3>
                      {comments.length === 0 ? <p className="muted">No comments yet.</p> : (
                        <ul>{comments.map((item) => <li key={item.id}><p>{item.body}</p><small>{item.author} · {new Date(item.created_at).toLocaleString()}</small></li>)}</ul>
                      )}
                      {mayDecide && selected.status === "in_review" && (
                        <label className="form-field" htmlFor={`review-comment-${selected.id}`}>
                          Reviewer comment
                          <textarea id={`review-comment-${selected.id}`} rows={3} value={comment} onChange={(event) => setComment(event.target.value)} disabled={busy} />
                        </label>
                      )}
                    </section>
                    {mayDecide && selected.status === "in_review" ? (
                      <div className="workflow-actions">
                        {openHigh.length > 0 && <p className="workflow-blockers">{openHigh.length} unresolved high-severity finding(s) block approval.</p>}
                        <button type="button" className="button button-primary" onClick={() => void decide("approve")} disabled={busy || openHigh.length > 0}>Approve</button>
                        <button type="button" className="button" onClick={() => void decide("request_changes")} disabled={busy || !comment.trim()}>Request changes</button>
                        <button type="button" className="button" onClick={() => void addComment()} disabled={busy || !comment.trim()}>Add comment</button>
                      </div>
                    ) : role === "brand_manager" || role === "admin" ? (
                      <p className="editor-notice" role="note">
                        {selected.status === "in_review"
                          ? "Only a Reviewer can approve or request changes."
                          : `Current persisted status: ${contentStatusLabel(selected.status)}.`}
                      </p>
                    ) : null}
                    <section className="workflow-comments">
                      <h3>Backend audit history</h3>
                      {auditEvents.length === 0 ? <p className="muted">No audit events have been recorded.</p> : (
                        <ul>{auditEvents.map((event) => <li key={event.id}><p>{event.action.replaceAll("_", " ")}</p><small>{event.actor} · {new Date(event.created_at).toLocaleString()}</small></li>)}</ul>
                      )}
                    </section>
                    <Link href={`/editor?id=${selected.id}`} className="button">Open in Write &amp; Review</Link>
                  </section>
                )}
                {selected && selected.status !== "in_review" && (
                  <section className="card workflow-action-card" aria-live="polite">
                    <h2>Review action complete</h2>
                    <p>
                      Content #{selected.id} is now <strong>{contentStatusLabel(selected.status)}</strong> at version {selected.version}.
                    </p>
                    <p>{comments.length} persisted comment(s) · {auditEvents.length} persisted audit event(s).</p>
                    <Link href={`/editor?id=${selected.id}`} className="button button-primary">Inspect updated content</Link>
                  </section>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!mayDecide && (role === "brand_manager" || role === "admin") && allDocuments.some((item) => item.status === "approved") && (
        <section className="card">
          <h2>Approved content</h2>
          {allDocuments.filter((item) => item.status === "approved").map((item) => (
            <div className="entry-card" key={item.id}>
              <span>{item.title} · version {item.version}</span>
              <button type="button" className="button" disabled={busy} onClick={() => void markReady(item.id)}>Mark ready to publish</button>
            </div>
          ))}
        </section>
      )}
      <p className="muted">Signed in as {user} · {documents.length} item(s) in review</p>
    </section>
  );
}
