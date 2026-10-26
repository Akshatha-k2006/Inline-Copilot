"use client";

import Link from "next/link";
import BackendStatus from "@/components/BackendStatus";
import EmptyState from "@/components/EmptyState";
import GettingStartedGuide from "@/components/GettingStartedGuide";
import SampleBrandButton from "@/components/SampleBrandButton";
import { useRole } from "@/lib/role";
import { canManageKnowledge, canViewReviewQueue } from "@/lib/workflow";
import {
  getQueuedDocuments,
  MOCK_DATA_NOTICE,
  useDemoWorkspace,
} from "@/lib/mock-data";

export default function Home() {
  const workspace = useDemoWorkspace();
  const { role } = useRole();
  const mayManageKnowledge = canManageKnowledge(role);
  const mayViewQueue = canViewReviewQueue(role);
  const queuedDocuments = getQueuedDocuments(workspace);
  const currentDocument = workspace.documents[0];
  const findingsCurrent = Boolean(
    currentDocument && workspace.findingsBody === currentDocument.body,
  );
  const openFindings = findingsCurrent
    ? workspace.findings.filter((finding) => finding.status === "open")
    : [];
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

      <GettingStartedGuide />

      {workspace.persistenceWarning && (
        <p className="form-error" role="alert">
          Saved dashboard data could not be loaded or saved in this browser: {workspace.persistenceWarning}
        </p>
      )}
      {!workspace.isHydrated ? (
        <p className="editor-notice" role="status">
          Loading saved demonstration statistics...
        </p>
      ) : workspace.persistenceWarning ? null : (
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
            <small>{findingsCurrent ? "Across current matching mock checks" : "No current mock review results"}</small>
          </article>
        </section>
      )}

      {workspace.isHydrated && workspace.documents.length === 0 && (
        <EmptyState
          title="No content is available yet"
          description={
            workspace.history.length === 0
              ? "There is no draft or recent workflow activity in this browser yet. Open Write & Review to begin the documented workflow; available demo content will appear there."
              : "There is no draft available in this browser. Open Write & Review to continue the documented workflow."
          }
          action={
            <Link href="/editor" className="button button-primary">
              Open Write &amp; Review
            </Link>
          }
          secondaryAction={
            <Link href="/knowledge?tab=guidelines" className="button">
              Explore Guidelines
            </Link>
          }
        />
      )}

      <div className="card">
        <div className="home-actions">
          <h2>Try it now</h2>
          <SampleBrandButton />
        </div>
        <p>
          {mayManageKnowledge
            ? "Load the fictional sample brand, then explore its guidelines, glossary, facts and assets."
            : "Explore the fictional sample brand's guidelines, glossary, facts and assets. Switch to the Brand Manager or Admin demo role to load or reset sample data."}
        </p>
        <p>
          <Link href="/editor" className="button button-primary">
            Open Write &amp; Review
          </Link>{" "}
          <Link href="/knowledge" className="button button-primary">
            Open the Knowledge base
          </Link>
          {" "}
          {mayViewQueue && (
            <Link href="/queue" className="button">
              Open the Review queue
            </Link>
          )}
        </p>
      </div>

      <BackendStatus />
    </section>
  );
}
