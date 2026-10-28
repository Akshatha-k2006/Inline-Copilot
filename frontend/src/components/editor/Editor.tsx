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
  const document = workspace.documents.find((item) => item.id === selectedDocumentId) ?? workspace.documents[0];
  const [title, setTitle] = useState(document?.title ?? "");
  const [body, setBody] = useState(document?.body ?? "");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("Untitled document");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newTitleInputRef = useRef<HTMLInputElement>(null);

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
    }, "Document created.");
  }

  const onSelect = (finding: DemoFinding) => {
    setSelectedId(finding.id);
    globalThis.document.getElementById(`draft-highlight-${finding.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (!document) return <section className="page"><h1>No demo document</h1><p className="muted">Reset the demo data to restore the sample workspace.</p></section>;

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
          <div className="panel-heading"><p className="eyebrow">My documents</p><button className="button" type="button" onClick={() => { setCreating((current) => { const next = !current; if (next) { setNewTitle("Untitled document"); window.setTimeout(() => newTitleInputRef.current?.focus(), 0); } return next; }); }} disabled={role !== "creator"}>New</button></div>
          {workspace.documents.map((item) => <button className={`document-list-item${item.id === document.id ? " active" : ""}`} type="button" key={item.id} onClick={() => setSelectedDocumentId(item.id)}>
            <strong>{item.title}</strong>
            <span>{contentStatusLabel(item.status)}</span>
          </button>)}
          <p className="muted">Sample data · saved in this browser</p>
          {document && role === "creator" && (document.status === "draft" || document.status === "changes_requested") && <button className="button button-danger" type="button" onClick={() => { if (globalThis.confirm("Delete this draft?")) { run(() => { deleteDemoDocument(document.id, role, user); setSelectedDocumentId(workspace.documents.find((item) => item.id !== document.id)?.id ?? null); }, "Document deleted."); } }}>Delete draft</button>}
        </aside>
        <section className="editor-main card">
          <div className="editor-toolbar">
            <input ref={titleInputRef} aria-label="Document title" className="title-input" value={title} onChange={(event) => setTitle(event.target.value)} disabled={!canEdit} placeholder="Untitled document" />
            <span className="autosave-indicator">Saved locally</span>
          </div>
          {creating && (
            <div className="card inline-create">
              <h2>Create a document</h2>
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
          )}
          <textarea
            aria-label="Document body"
            className="document-editor"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={!canEdit}
            spellCheck
            placeholder="Start writing your on-brand content here..."
          />
          <div className="editor-meta"><span>{body.trim().split(/\s+/).filter(Boolean).length} words · {readingTime} min read</span><span>{reviewState === "current" ? "Review is current" : "Review needed"}</span></div>
          {findings.length > 0 && (
            <HighlightedDraft body={body} findings={findings} selectedFindingId={selectedId} onSelect={onSelect} />
          )}
          <div className="editor-actions">
            {canEdit && <button className="button" type="button" onClick={save}>Save draft</button>}
            {canEdit && <button className="button button-primary" type="button" onClick={reviewDraft}>Run full review</button>}
            {canEdit && reviewState === "current" && openCount === 0 && <button className="button button-success" type="button" onClick={submit}>Submit for review</button>}
          </div>
        </section>
        <div className="editor-side">
          <FindingsPanel
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
          />
        </div>
      </div>
      {!canEdit && role === "creator" && <p className="muted">This document is locked while it is in review. Reviewers can inspect it from the Review Queue.</p>}
      {role !== "creator" && <Link className="button" href="/queue">Open review queue</Link>}
    </section>
  );
}
