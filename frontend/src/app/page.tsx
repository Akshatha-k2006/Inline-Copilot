"use client";

import Link from "next/link";
import BackendStatus from "@/components/BackendStatus";
import SampleBrandButton from "@/components/SampleBrandButton";
import { MOCK_DATA_NOTICE, useDemoWorkspace } from "@/lib/mock-data";

export default function Home() {
  const workspace = useDemoWorkspace();
  const queuedDocuments = workspace.documents.filter((document) =>
    workspace.queueDocumentIds.includes(document.id),
  );
  const openFindings = workspace.findings.filter(
    (finding) => finding.status === "open",
  );
  const reviewRuns = workspace.history.filter(
    (entry) => entry.action === "reviewed",
  ).length;

  return (
    <section className="page">
      <h1>Check content against your brand before it goes out</h1>
      <p className="lead">
        Inline Copilot reviews text against approved guidelines, glossary terms
        and facts, explains every issue with its source, and leaves the decision
        to a person. Nothing is published automatically.
      </p>

      <p className="mock-data-notice" role="note">{MOCK_DATA_NOTICE}</p>

      <section className="demo-stat-grid" aria-label="Demonstration statistics">
        <article className="demo-stat-card">
          <span>Documents in review</span>
          <strong>{queuedDocuments.length}</strong>
          <small>Fictional sample documents</small>
        </article>
        <article className="demo-stat-card">
          <span>Sample review runs</span>
          <strong>{reviewRuns}</strong>
          <small>Not verified checks</small>
        </article>
        <article className="demo-stat-card">
          <span>Open sample findings</span>
          <strong>{openFindings.length}</strong>
          <small>Across the demonstration review</small>
        </article>
      </section>

      <div className="card">
        <div className="home-actions">
          <h2>Try it now</h2>
          <SampleBrandButton />
        </div>
        <p>Load the sample brand in one click, then explore its guidelines, glossary, facts and assets.</p>
        <h2>Try it in five steps</h2>
        <ol className="steps">
          <li>Open the Knowledge base to view or edit brand information.</li>
          <li>
            Open Write &amp; Review and run a review on the sample draft, or paste your
            own text.
          </li>
          <li>Accept, edit or dismiss each flag.</li>
          <li>Submit for review, then switch Role (top right) to Reviewer.</li>
          <li>Approve the content or request changes.</li>
        </ol>
        <p>
          <Link href="/editor" className="button button-primary">
            Open Write &amp; Review
          </Link>{" "}
          <Link href="/knowledge" className="button button-primary">
            Open the Knowledge base
          </Link>
          {" "}
          <Link href="/queue" className="button">
            Open the Review queue
          </Link>
        </p>
      </div>

      <BackendStatus />
    </section>
  );
}
