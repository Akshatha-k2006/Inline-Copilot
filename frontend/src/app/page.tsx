"use client";

import Link from "next/link";
import { useRole } from "@/lib/role";
import {
  formatMockTimestamp,
  getDocumentFindings,
  getQueuedDocuments,
  MOCK_DATA_NOTICE,
  useDemoWorkspace,
} from "@/lib/mock-data";
import { contentStatusLabel } from "@/lib/workflow";

function displayName(user: string): string {
  return user.replace(/\s+\([^)]*\)$/, "");
}

export default function Home() {
  const { role, user, label } = useRole();
  const workspace = useDemoWorkspace();
  const document = workspace.documents[0];
  const findings = document ? getDocumentFindings(workspace, document.id) : [];
  const openFindings = findings.filter((finding) => finding.status === "open");
  const queued = getQueuedDocuments(workspace);
  const isManager = role === "brand_manager" || role === "admin";

  return (
    <section className="page dashboard">
      <header className="dashboard-welcome">
        <div>
          <p className="eyebrow">CoRESpace / {label}</p>
          <h1>Welcome back, {displayName(user)}</h1>
          <p className="lead">
            {role === "creator"
              ? "Write on-brand content with guidance at your fingertips."
              : role === "reviewer"
                ? "Review submitted work with clear evidence and context."
                : "Keep the brand system consistent and ready to use."}
          </p>
          <p className="dashboard-summary">{MOCK_DATA_NOTICE}</p>
        </div>
        <Link className="button button-primary" href="/editor">
          {role === "creator" ? "Continue writing" : "Open workspace"}
        </Link>
      </header>

      <section className="demo-stat-grid" aria-label="Workspace snapshot">
        <div className="demo-stat-card"><strong>{workspace.documents.length}</strong><small>Documents</small></div>
        <div className="demo-stat-card"><strong>{openFindings.length}</strong><small>Open findings</small></div>
        <div className="demo-stat-card"><strong>{queued.length}</strong><small>Awaiting review</small></div>
        <div className="demo-stat-card"><strong>{workspace.knowledge.guidelines.length}</strong><small>Approved guidelines</small></div>
      </section>

      <section className="dashboard-data-section">
        <div className="dashboard-section-heading">
          <div><p className="eyebrow">Your workspace</p><h2>{role === "reviewer" ? "Review queue" : "Recent documents"}</h2></div>
          <span className="sample-data-label">Sample data</span>
        </div>
        <div className="card">
          {role === "reviewer" && queued.length === 0 ? (
            <p className="muted">No documents are waiting for review yet.</p>
          ) : document ? (
            <div className="entry-card">
              <div className="entry-content">
                <p className="eyebrow">{document.content_type.replaceAll("_", " ")}</p>
                <h2>{document.title}</h2>
                <p className="muted">
                  Updated {formatMockTimestamp(document.updated_at)} · {contentStatusLabel(document.status)}
                </p>
              </div>
              <Link className="button" href={`/editor?id=${document.id}`}>Open document</Link>
            </div>
          ) : (
            <p className="muted">No assigned documents.</p>
          )}
        </div>
      </section>

      {role === "creator" && (
        <section className="card">
          <p className="eyebrow">Getting started</p>
          <h2>Make your first polished draft</h2>
          <p className="muted">Open the inline editor, run a review, and resolve each finding using its supporting brand source.</p>
          <Link className="button button-primary" href="/editor">Open Inline Editor</Link>
        </section>
      )}

      {isManager && (
        <section className="card">
          <p className="eyebrow">Brand library</p>
          <h2>One shared source of truth</h2>
          <p className="muted">Manage sample guidelines, terminology, approved facts, and assets. Changes are saved in this browser.</p>
          <Link className="button" href="/knowledge">Browse brand library</Link>
        </section>
      )}
    </section>
  );
}
