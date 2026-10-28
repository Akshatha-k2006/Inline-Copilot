"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRole } from "@/lib/role";
import {
  createDemoDocument,
  deleteDemoDocument,
  getDocumentFindings,
  recordDemoReview,
  resolveDemoFinding,
  saveDemoDraft,
  transitionDemoDocument,
  useDemoWorkspace,
} from "@/lib/mock-data";
import type { DemoFinding } from "@/lib/mock-findings";
import type { FindingStatus } from "@/lib/types";
import { contentStatusLabel } from "@/lib/workflow";
import FindingsPanel from "./FindingsPanel";
import HighlightedDraft from "./HighlightedDraft";

function statusLabel(status: string): string {
  return status === "in_review" ? "Pending Review" : contentStatusLabel(status as Parameters<typeof contentStatusLabel>[0]);
}

function statusClass(status: string): string {
  return status === "in_review" ? "status-in_review" : `status-${status}`;
}

export default function Editor() {
  const { role, user } = useRole();
  const workspace = useDemoWorkspace();
  const [activeDocId, setActiveDocId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = workspace.isHydrated;

  const documents = role === "creator"
    ? workspace.documents
    : workspace.documents.filter((item) =>
        ["in_review", "changes_requested", "approved", "rejected", "ready_to_publish"].includes(item.status),
      );
  const document = documents.find((item) => item.id === activeDocId);
  const findings = document ? getDocumentFindings(workspace, document.id) : [];
  const review = workspace.reviews.find((item) => item.document_id === document?.id);
  const reviewState = review && review.document_version === document?.version && review.body === body
    ? "current"
    : review ? "stale" : "not-run";
  const canEdit = role === "creator" && Boolean(document) &&
    (document?.status === "draft" || document?.status === "changes_requested");
  const openFindings = findings.filter((finding) => finding.status === "open");
  const severityCounts = {
    high: openFindings.filter((finding) => finding.severity === "high").length,
    medium: openFindings.filter((finding) => finding.severity === "medium").length,
    low: openFindings.filter((finding) => finding.severity === "low").length,
  };
  const reviewerFeedback = document
    ? workspace.comments.filter((comment) =>
        comment.document_id === document.id &&
        (document.status === "changes_requested" || document.status === "rejected"),
      )
    : [];
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  useEffect(() => {
    if (activeDocId !== null || typeof window === "undefined") return;
    const requestedId = Number(new URLSearchParams(window.location.search).get("id"));
    if (Number.isInteger(requestedId) && documents.some((item) => item.id === requestedId)) {
      setActiveDocId(requestedId);
    }
  }, [activeDocId, documents]);

  useEffect(() => {
    setTitle(document?.title ?? "");
    setBody(document?.body ?? "");
  }, [document?.id, document?.updated_at]);

  useEffect(() => {
    if (activeDocId !== null && !document) setActiveDocId(null);
  }, [activeDocId, document]);

  function run(action: () => void, success: string) {
    try {
      action();
      setMessage(success);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The demo action could not be completed.");
      setMessage("");
    }
  }

  function openDocument(id: number) {
    setActiveDocId(id);
    setMessage("");
    setError("");
  }

  function createDocument() {
    run(() => {
      const created = createDemoDocument(
        "Untitled document",
        "Start writing your on-brand content here.",
        role,
        user,
      );
      setActiveDocId(created.id);
      setTimeout(() => bodyRef.current?.focus(), 0);
    }, "New draft created.");
  }

  function deleteDocument() {
    if (!document || !globalThis.confirm(`Delete "${document.title}"?`)) return;
    run(() => {
      deleteDemoDocument(document.id, role, user);
      setActiveDocId(null);
    }, "Document deleted.");
  }

  function save() {
    if (!document || !canEdit) return;
    run(() => saveDemoDraft(document.id, title, body, role, user), "Draft saved locally.");
  }

  function reviewDraft() {
    if (!document || !canEdit) return;
    run(() => {
      if (title !== document.title || body !== document.body) {
        saveDemoDraft(document.id, title, body, role, user);
      }
      recordDemoReview(document.id, body, role, user);
    }, "Copilot review complete. Findings are based on the configured brand rules.");
  }

  function resolve(
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
    dismissalReason = "",
  ) {
    if (!document) return;
    run(() => {
      const result = resolveDemoFinding(
        finding.id,
        status,
        finalText,
        role,
        user,
        dismissalReason,
      );
      setTitle(result.document.title);
      setBody(result.document.body);
    }, status === "dismissed" ? "Finding dismissed and recorded." : "Finding resolved.");
  }

  function submit() {
    if (!document) return;
    run(() => {
      transitionDemoDocument(
        document.id,
        document.status === "changes_requested" ? "resubmit" : "submit",
        role,
        user,
      );
    }, document.status === "changes_requested" ? "Draft resubmitted for review." : "Draft submitted to the review queue.");
  }

  const onSelectFinding = (finding: DemoFinding) => {
    globalThis.document.getElementById(`draft-highlight-${finding.id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  if (!hydrated) {
    return <section className="page editor-page"><div className="editor-loading-state" role="status">Loading workspace documents...</div></section>;
  }

  if (document) {
    return (
      <section className="page editor-page editor-page--redesigned">
        <header className="write-header">
          <div className="write-header-left">
            <button className="button back-button" type="button" onClick={() => setActiveDocId(null)}>
              <span aria-hidden="true">←</span> Workspace Documents
            </button>
            <div>
              <p className="eyebrow">CoRESpace / Inline Editor / Write</p>
              <h1>Write and refine your draft</h1>
              <p className="lead">Shape your message, review Copilot evidence, and submit when it is ready.</p>
            </div>
          </div>
          {role === "creator" && (document.status === "draft" || document.status === "changes_requested") && (
            <button className="button button-danger" type="button" onClick={deleteDocument}>Delete file</button>
          )}
        </header>

        {message && <p className="editor-notice" role="status">{message}</p>}
        {error && <p className="editor-error" role="alert"><span>{error}</span></p>}

        <div className="write-document-meta">
          <input
            ref={titleRef}
            className="write-title-input"
            aria-label="Document title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!canEdit}
          />
          <div className="write-meta-details">
            <span className={`content-status ${statusClass(document.status)}`}>{statusLabel(document.status)}</span>
            <span className="muted">Last saved {document.updated_at ? new Date(document.updated_at).toLocaleString() : "not yet"}</span>
            <span className="muted">Saved locally</span>
          </div>
        </div>

        <div className="write-workspace">
          <section className="write-canvas card" aria-labelledby="writer-canvas-heading">
            <div className="write-canvas-heading">
              <div>
                <p className="eyebrow">Step 2 · Writer Canvas</p>
                <h2 id="writer-canvas-heading">Draft content</h2>
              </div>
              <span className="write-word-count">{wordCount} words</span>
            </div>
            <textarea
              ref={bodyRef}
              className="write-editor-textarea"
              aria-label="Document body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={!canEdit}
              spellCheck
              placeholder="Start writing your on-brand content here..."
            />
            {findings.length > 0 && (
              <HighlightedDraft
                body={body}
                findings={findings}
                selectedFindingId={null}
                onSelect={onSelectFinding}
              />
            )}
            <div className="write-canvas-footer">
              <span className="muted">Autosave status: Saved locally</span>
              <span className="muted">Reading time: {Math.max(1, Math.ceil(wordCount / 200))} min</span>
            </div>
            <div className="write-action-bar">
              {canEdit && <button className="button" type="button" onClick={save}>Save draft</button>}
              {canEdit && <button className="button" type="button" onClick={reviewDraft}>Run Copilot Review</button>}
              {canEdit && reviewState === "current" && openFindings.length === 0 && (
                <button className="button button-primary" type="button" onClick={submit}>
                  {document.status === "changes_requested" ? "Re-submit for Review" : "Submit to Review Queue"}
                </button>
              )}
            </div>
          </section>

          <aside className="write-review-column">
            {reviewerFeedback.length > 0 ? (
              <section className="reviewer-message-carrier" aria-labelledby="reviewer-message-heading">
                <p className="eyebrow">Reviewer message</p>
                <h2 id="reviewer-message-heading">Changes to address</h2>
                {reviewerFeedback.map((comment) => (
                  <blockquote key={comment.id}>
                    <span className="message-icon" aria-hidden="true">✦</span>
                    <span><strong>From Reviewer {comment.author}:</strong> {comment.text}</span>
                  </blockquote>
                ))}
              </section>
            ) : (
              <section className="pre-review-tip" aria-label="Pre-submission guidance">
                <p className="eyebrow">Copilot guidance</p>
                <h2>Review before you submit</h2>
                <p>Run Copilot Review to check terminology, tone, claims, and approved brand evidence. Editorial approval is still a human decision.</p>
              </section>
            )}
            <FindingsPanel
              findings={findings}
              busyFindingIds={[]}
              readOnly={!canEdit}
              reviewState={reviewState}
              canRunReview={canEdit}
              onRunReview={reviewDraft}
              selectedFindingId={null}
              reviewedCustomText={false}
              onSelect={onSelectFinding}
              onResolve={(finding, status, finalText, dismissalReason) =>
                Promise.resolve(resolve(finding, status, finalText, dismissalReason))
              }
            />
            {findings.length > 0 && (
              <div className="write-finding-summary" aria-label="Finding summary">
                <span className="severity-badge severity-badge-high">{severityCounts.high} Errors</span>
                <span className="severity-badge severity-badge-medium">{severityCounts.medium} Warnings</span>
                <span className="severity-badge severity-badge-low">{severityCounts.low} Info</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    );
  }

  return (
    <section className="page editor-page editor-hub-page">
      <header className="document-hub-header">
        <div>
          <p className="eyebrow">CoRESpace / Inline Editor</p>
          <h1>Workspace Documents</h1>
          <p className="lead">Select a document from the list below to open the editor or start a new draft.</p>
        </div>
        {role === "creator" && <button className="button button-primary" type="button" onClick={createDocument}>+ Create New Document</button>}
      </header>
      {message && <p className="editor-notice" role="status">{message}</p>}
      {error && <p className="editor-error" role="alert"><span>{error}</span></p>}
      {documents.length === 0 ? (
        <div className="editor-empty-state document-hub-empty">
          <span className="empty-state-mark" aria-hidden="true">+</span>
          <h2>{role === "creator" ? "No workspace documents yet" : "No submitted documents"}</h2>
          <p>{role === "creator" ? "Create a draft to start writing with Copilot." : "Submitted drafts will appear here for inspection."}</p>
          {role === "creator" && <button className="button button-primary" type="button" onClick={createDocument}>Create New Document</button>}
        </div>
      ) : (
        <div className="document-hub-list" aria-label="Workspace documents">
          {documents.map((item) => {
            const itemFindings = getDocumentFindings(workspace, item.id);
            const itemOpenFindings = itemFindings.filter((finding) => finding.status === "open");
            const errors = itemOpenFindings.filter((finding) => finding.severity === "high").length;
            const warnings = itemOpenFindings.filter((finding) => finding.severity === "medium").length;
            return (
              <article className="document-hub-row" key={item.id}>
                <div className="document-hub-title">
                  <span className="document-file-icon" aria-hidden="true">▤</span>
                  <div>
                    <h2>{item.title || "Untitled document"}</h2>
                    <p>{item.created_by} · {new Date(item.updated_at).toLocaleString()}</p>
                  </div>
                </div>
                <span className={`content-status ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>
                <span className="document-hub-findings">
                  {itemFindings.length === 0
                    ? "Findings not loaded"
                    : itemOpenFindings.length === 0
                      ? "Clean draft"
                      : `${itemOpenFindings.length} open finding${itemOpenFindings.length === 1 ? "" : "s"}${errors || warnings ? ` · ${errors} errors · ${warnings} warnings` : ""}`}
                </span>
                <div className="document-hub-actions">
                  <button className="button button-primary" type="button" onClick={() => openDocument(item.id)}>Open editor ↗</button>
                  {role === "creator" && (item.status === "draft" || item.status === "changes_requested") && (
                    <button className="button button-danger" type="button" onClick={() => {
                      if (globalThis.confirm(`Delete "${item.title}"?`)) {
                        run(() => deleteDemoDocument(item.id, role, user), "Document deleted.");
                      }
                    }}>Delete</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
