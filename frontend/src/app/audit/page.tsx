"use client";

import Link from "next/link";
import {
  formatMockTimestamp,
  MOCK_DATA_NOTICE,
  useDemoWorkspace,
} from "@/lib/mock-data";

export default function AuditPage() {
  const workspace = useDemoWorkspace();
  const document = workspace.documents[0];
  const reviewCount = workspace.history.filter(
    (entry) => entry.action === "reviewed",
  ).length;

  return (
    <section className="page">
      <div>
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Review history</h1>
        <p className="lead">A timeline of demonstration activity for the sample document.</p>
      </div>
      <p className="mock-data-notice" role="note">{MOCK_DATA_NOTICE}</p>

      {document && (
        <section className="card mock-history-summary" aria-labelledby="history-document-heading">
          <div>
            <p className="eyebrow">Document #{document.id}</p>
            <h2 id="history-document-heading">{document.title}</h2>
            <p className="muted">Current status: {document.status.replaceAll("_", " ")}</p>
          </div>
          <div className="mock-history-count">
            <strong>{reviewCount}</strong>
            <span>sample review runs</span>
          </div>
          <Link href="/editor" className="button button-primary">
            Open in Write &amp; Review
          </Link>
        </section>
      )}

      <ol className="mock-history-list" aria-label="Demonstration review timeline">
        {[...workspace.history].reverse().map((entry) => (
          <li className="mock-history-item" key={entry.id}>
            <time dateTime={entry.at}>{formatMockTimestamp(entry.at)}</time>
            <div>
              <h2>{entry.action.replaceAll("_", " ")}</h2>
              <p>{entry.detail}</p>
              <p className="muted">{entry.actor} · {entry.role.replaceAll("_", " ")}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
