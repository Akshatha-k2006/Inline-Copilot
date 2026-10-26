"use client";

import Link from "next/link";
import {
  formatMockTimestamp,
  getQueuedDocuments,
  MOCK_DATA_NOTICE,
  useDemoWorkspace,
} from "@/lib/mock-data";

export default function ReviewQueuePage() {
  const workspace = useDemoWorkspace();
  const documents = getQueuedDocuments(workspace);

  return (
    <section className="page">
      <div>
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Review queue</h1>
        <p className="lead">Demonstration documents awaiting a human review.</p>
      </div>
      <p className="mock-data-notice" role="note">{MOCK_DATA_NOTICE}</p>

      {documents.length === 0 ? (
        <div className="card">
          <h2>No documents in the demonstration queue</h2>
          <p className="muted">Queue data is not connected to a live service.</p>
        </div>
      ) : (
        <ul className="entry-list">
          {documents.map((document) => {
            const findings = workspace.findings.filter(
              (finding) => finding.content_id === document.id,
            );
            const openCount = findings.filter(
              (finding) => finding.status === "open",
            ).length;

            return (
              <li className="entry-card mock-document-card" key={document.id}>
                <div className="entry-content">
                  <p className="eyebrow">Document #{document.id}</p>
                  <h2>{document.title}</h2>
                  <p className="mock-document-preview">{document.body}</p>
                  <div className="fact-meta">
                    <span>Status: <strong>{document.status.replaceAll("_", " ")}</strong></span>
                    <span>Version: <strong>{document.version}</strong></span>
                    <span>Open mock findings: <strong>{openCount}</strong></span>
                  </div>
                  <p className="muted">
                    Updated {formatMockTimestamp(document.updated_at)} · Created by {document.created_by}
                  </p>
                </div>
                <div className="entry-actions">
                  <Link href="/editor" className="button button-primary">
                    Open in Write &amp; Review
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
