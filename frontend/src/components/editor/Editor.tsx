"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRole } from "@/lib/role";
import {
  getDocumentFindings,
  createDemoDocument,
  deleteDemoDocument,
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

export default function Editor() {
  const { role, user } = useRole();
  const workspace = useDemoWorkspace();
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const visibleDocuments = role === "creator"
    ? workspace.documents
    : workspace.documents.filter((item) => item.status === "in_review" || item.status === "changes_requested" || item.status === "approved" || item.status === "rejected" || item.status === "ready_to_publish");
  const document = visibleDocuments.find((item) => item.id === selectedDocumentId) ?? visibleDocuments[0] ?? workspace.documents.find((item) => item.id === selectedDocumentId);
  const [title, setTitle] = useState(document?.title ?? "");
  const [body, setBody] = useState(document?.body ?? "");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("Untitled document");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newTitleInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const findings = document ? getDocumentFindings(workspace, document.id) : [];
  const review = workspace.reviews.find((item) => item.document_id === document?.id);
  const reviewState = review && review.document_version === document?.version && review.body === body
    ? "current"
    : review ? "stale" : "not-run";
  const canEdit = role === "creator" && document?.status === "draft";
  const openCount = findings.filter((finding) => finding.status === "open").length;
  const readingTime = Math.max(1, Math.ceil(body.trim().split(/\s+/).filter(Boolean).length / 200));

  useEffect(() => {
    if (selectedDocumentId === null && workspace.documents[0]) {
      setSelectedDocumentId(workspace.documents[0].id);
    }
  }, [selectedDocumentId, workspace.documents]);

  useEffect(() => {
    setTitle(document?.title ?? "");
    setBody(document?.body ?? "");
  }, [document?.id, document?.updated_at]);

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

  function save() {
    if (!document || !canEdit) return;
    run(() => {
      const saved = saveDemoDraft(document.id, title, body, role, user);
      setTitle(saved.title);
    }, "Draft saved locally.");
  }

  function reviewDraft() {
    if (!document || !canEdit) return;
    run(() => {
      if (title !== document.title || body !== document.body) {
        saveDemoDraft(document.id, title, body, role, user);
      }
      recordDemoReview(document.id, body, role, user);
    }, "Review complete. Findings are based on the sample brand rules.");
  }

  function resolve(
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
    dismissalReason = "",
  ) {
    if (!document) return;
    run(() => {
      const result = resolveDemoFinding(finding.id, status, finalText, role, user, dismissalReason);
      setTitle(result.document.title);
      setBody(result.document.body);
    }, status === "dismissed" ? "Finding dismissed and recorded in the demo audit." : "Finding resolved.");
  }

  function submit() {
    if (!document) return;
    run(() => {
      transitionDemoDocument(document.id, document.status === "changes_requested" ? "resubmit" : "submit", role, user);
    }, "Draft submitted for review.");
  }

  function createDocument() {
    run(() => {
      const created = createDemoDocument(newTitle.trim() || "Untitled document", "Start writing your on-brand content here.", role, user);
      setSelectedDocumentId(created.id);
      setTitle(created.title);
      setBody(created.body);
      setCreating(false);
      setNewTitle("Untitled document");
      setTimeout(() => {
        bodyRef.current?.focus();
      }, 0);
    }, "Document created.");
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
          <div className="panel-heading"><p className="eyebrow">My documents</p><button className="button" type="button" onClick={() => { setCreating(true); setSelectedDocumentId(null); setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); }}>+ New</button></div>
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
    <section className="page editor-page editor-page--redesigned">
      {message && <p className="editor-notice" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="editor-workspace">
        <aside className="editor-document-panel card">
          <div className="document-panel-header">
            <div>
              <p className="eyebrow">Documents</p>
              <h2 className="panel-title">My Documents</h2>
            </div>
            {role === "creator" && <button className="button button-primary" type="button" onClick={() => { setCreating(true); setSelectedDocumentId(null); setTitle(""); setBody(""); setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); }}>+ New</button>}
          </div>
          {visibleDocuments.map((item) => (
            <button className={`document-list-card${item.id === document?.id ? " active" : ""}`} type="button" key={item.id} onClick={() => { setSelectedDocumentId(item.id); setCreating(false); if (role === "creator" && item.status === "draft") { setTimeout(() => bodyRef.current?.focus(), 0); } }}>
              <div className="document-list-card-main">
                <strong className="document-list-card-title">{item.title}</strong>
                <span className={`document-status-badge status-${item.status}`}>{contentStatusLabel(item.status)}</span>
              </div>
              <span className="document-list-card-meta">Updated recently</span>
            </button>
          ))}
          {visibleDocuments.length === 0 && <p className="muted">{role === "creator" ? "No documents yet." : "No submitted documents."}</p>}
          {document && role === "creator" && (document.status === "draft" || document.status === "changes_requested") && <button className="button button-danger" type="button" style={{ marginTop: "auto" }} onClick={() => { if (globalThis.confirm("Delete this draft?")) { run(() => { deleteDemoDocument(document.id, role, user); const fallback = workspace.documents.find((item) => item.id !== document.id && (role === "creator" || item.status === "in_review" || item.status === "changes_requested" || item.status === "approved" || item.status === "rejected" || item.status === "ready_to_publish")); setSelectedDocumentId(fallback?.id ?? null); }, "Document deleted."); } }}>Delete draft</button>}
        </aside>
        <section className="editor-main-panel card">
          {creating ? (
            <>
              <div className="editor-main-header">
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
            <div className="editor-main-header">
              <div className="editor-main-title-group">
                <input ref={titleInputRef} aria-label="Document title" className="editor-main-title-input" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} placeholder="Untitled document" />
                <div className="editor-main-meta">
                  <span className={`status-pill status-${document.status}`}>{contentStatusLabel(document.status)}</span>
                  <span className="muted">Last edited · just now</span>
                  <span className="muted">Save status: Saved locally</span>
                </div>
              </div>
            </div>
            {findings.length > 0 ? (
              <HighlightedDraft body={body} findings={findings} selectedFindingId={selectedId} onSelect={onSelect} />
            ) : (
              <textarea
                ref={bodyRef}
                aria-label="Document body"
                className="document-editor document-editor-large"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={!canEdit}
                spellCheck
                placeholder="Start writing your on-brand content here..."
              />
            )}
          </>)}
        </section>
        <aside className="editor-findings-panel">
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
        </aside>
      </div>
      <div className="editor-bottom-bar">
        <div className="editor-bottom-left">
          <span className="bottom-finding-count">{openCount} open finding{openCount === 1 ? "" : "s"}</span>
          <span className="muted">Resolve relevant issues before submission</span>
        </div>
        <div className="editor-bottom-actions">
          {canEdit && <button className="button" type="button" onClick={save}>Save Draft</button>}
          {canEdit && reviewState === "current" && openCount === 0 && <button className="button button-primary" type="button" onClick={submit}>Submit for Review</button>}
        </div>
      </div>
      {document && !canEdit && role === "creator" && <p className="muted">This document is locked while it is in review. Reviewers can inspect it from the Review Queue.</p>}
      {document && role !== "creator" && <Link className="button" href="/queue">Open review queue</Link>}
    </section>
  );
}
