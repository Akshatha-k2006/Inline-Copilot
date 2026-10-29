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

  const onSelect = (finding: DemoFinding) => {
    setSelectedId(finding.id);
    globalThis.document.getElementById(`draft-highlight-${finding.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (!document && role === "creator") return (
    <section className="page editor-page">
      <header className="editor-header">
        <div>
          <p className="eyebrow">CoRESpace / Inline Editor</p>
          <h1>Write with confidence</h1>
          <p className="lead">Review exact phrases against approved brand knowledge before sharing your work.</p>
        </div>
      </header>
      {message && <p className="editor-notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-layout">
        <aside className="editor-document-list card">
          <div className="panel-heading"><p className="eyebrow">My documents</p><button className="button" type="button" onClick={() => { setCreating(true); setSelectedDocumentId(null); setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); }}>New</button></div>
          {workspace.documents.map((item) => <button className="document-list-item" type="button" key={item.id} onClick={() => { setSelectedDocumentId(item.id); setCreating(false); }}>
            <strong>{item.title}</strong>
            <span>{contentStatusLabel(item.status)}</span>
          </button>)}
          <p className="muted">Sample data · saved in this browser</p>
        </aside>
        <section className="editor-main card">
          {creating ? (
            <>
              <div className="editor-toolbar">
                <h2 style={{ margin: 0 }}>Create a new document</h2>
              </div>
              <div className="card inline-create" style={{ margin: 0 }}>
                <p className="muted">A new local draft will be shared across the demo roles.</p>
                <label className="form-field" style={{ width: "100%" }}>
                  <span>Title</span>
                  <input ref={newTitleInputRef} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createDocument(); } }} />
                </label>
                <div className="form-actions">
                  <button className="button button-primary" type="button" onClick={createDocument}>Create draft</button>
                  <button className="button" type="button" onClick={() => { setCreating(false); setNewTitle("Untitled document"); }}>Cancel</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="editor-toolbar">
                <input ref={titleInputRef} aria-label="Document title" className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} disabled placeholder="Untitled document" />
                <span className="autosave-indicator">Saved locally</span>
              </div>
              <textarea aria-label="Document body" className="document-editor" value="" disabled placeholder="Start writing your on-brand content here..." />
              <div className="editor-actions">
                <button className="button button-primary" type="button" onClick={() => { setCreating(true); setSelectedDocumentId(null); setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); }}>Create your first draft</button>
              </div>
            </>
          )}
        </section>
        <div className="editor-side"></div>
      </div>
    </section>
  );

  if (!document && role !== "creator") return <section className="page"><h1>No documents to review</h1><p className="muted">No drafts have been submitted for review yet.</p><Link className="button button-primary" href="/queue">Open review queue</Link></section>;

  return (
    <section className="page editor-page">
      <header className="editor-header">
        <div>
          <p className="eyebrow">CoRESpace / Inline Editor</p>
          <h1>Write with confidence</h1>
          <p className="lead">Review exact phrases against approved brand knowledge before sharing your work.</p>
        </div>
        <span className={`status-pill status-${document.status}`}>{contentStatusLabel(document.status)}</span>
      </header>
      {message && <p className="editor-notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-layout">
        <aside className="editor-document-list card">
          <div className="panel-heading"><p className="eyebrow">{role === "creator" ? "My documents" : "Submitted documents"}</p>{role === "creator" && <button className="button" type="button" onClick={() => { setCreating(true); setSelectedDocumentId(null); setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); }}>New</button>}</div>
          {visibleDocuments.map((item) => <button className={`document-list-item${item.id === document?.id ? " active" : ""}`} type="button" key={item.id} onClick={() => { setSelectedDocumentId(item.id); setCreating(false); if (canEdit) { setTimeout(() => bodyRef.current?.focus(), 0); } }}>
            <strong>{item.title}</strong>
            <span>{contentStatusLabel(item.status)}</span>
          </button>)}
          {visibleDocuments.length === 0 && <p className="muted">{role === "creator" ? "No documents yet." : "No submitted documents."}</p>}
          <p className="muted">Sample data · saved in this browser</p>
          {document && role === "creator" && (document.status === "draft" || document.status === "changes_requested") && <button className="button button-danger" type="button" onClick={() => { if (globalThis.confirm("Delete this draft?")) { run(() => { deleteDemoDocument(document.id, role, user); const fallback = workspace.documents.find((item) => item.id !== document.id && (role === "creator" || item.status === "in_review" || item.status === "changes_requested" || item.status === "approved" || item.status === "rejected" || item.status === "ready_to_publish")); setSelectedDocumentId(fallback?.id ?? null); }, "Document deleted."); } }}>Delete draft</button>}
        </aside>
        <section className="editor-main card">
          {creating ? (
            <>
              <div className="editor-toolbar">
                <h2 style={{ margin: 0 }}>Create a new document</h2>
              </div>
              <div className="card inline-create" style={{ margin: 0 }}>
                <p className="muted">A new local draft will be shared across the demo roles.</p>
                <label className="form-field" style={{ width: "100%" }}>
                  <span>Title</span>
                  <input ref={newTitleInputRef} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createDocument(); } }} />
                </label>
                <div className="form-actions">
                  <button className="button button-primary" type="button" onClick={createDocument}>Create draft</button>
                  <button className="button" type="button" onClick={() => { setCreating(false); if (document) { setTitle(document.title); setBody(document.body); } else { setSelectedDocumentId(workspace.documents[0]?.id ?? null); } }}>Cancel</button>
                </div>
              </div>
            </>
          ) : !document ? (
            <div className="editor-empty-state">
              <span className="empty-state-mark" aria-hidden="true">i</span>
              <h3>No document to edit</h3>
              <p className="muted">{role === "creator" ? "Create a draft to get started." : "Nothing has been submitted for review yet."}</p>
              {role === "creator" && <button className="button button-primary" type="button" onClick={() => { setCreating(true); setSelectedDocumentId(null); setTitle(""); setBody(""); setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); }}>Create a new draft</button>}
            </div>
          ) : (<>
          <div className="editor-toolbar">
            <input ref={titleInputRef} aria-label="Document title" className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} placeholder="Untitled document" />
            <span className="autosave-indicator">Saved locally</span>
          </div>
          {findings.length > 0 ? (
            <HighlightedDraft body={body} findings={findings} selectedFindingId={selectedId} onSelect={onSelect} />
          ) : (
            <textarea
              ref={bodyRef}
              aria-label="Document body"
              className="document-editor"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={!canEdit}
              spellCheck
              placeholder="Start writing your on-brand content here..."
            />
          )}
          <div className="editor-meta"><span>{body.trim().split(/\s+/).filter(Boolean).length} words · {readingTime} min read</span><span>{reviewState === "current" ? "Review is current" : "Review needed"}</span></div>
          <div className="editor-actions">
            {canEdit && <button className="button" type="button" onClick={save}>Save draft</button>}
            {canEdit && <button className="button button-primary" type="button" onClick={reviewDraft}>Run full review</button>}
            {canEdit && reviewState === "current" && openCount === 0 && <button className="button button-success" type="button" onClick={submit}>Submit for review</button>}
          </div>
          </>)}
        </section>
        <div className="editor-side">
          {document && <FindingsPanel
            findings={findings}
            busyFindingIds={[]}
            readOnly={!canEdit}
            reviewState={reviewState}
            canRunReview={canEdit}
            onRunReview={reviewDraft}
            selectedFindingId={selectedId}
            reviewedCustomText={false}
            onSelect={onSelect}
            onResolve={(finding, status, finalText, dismissalReason) => Promise.resolve(resolve(finding, status, finalText, dismissalReason))}
          />}
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
