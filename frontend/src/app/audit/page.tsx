"use client";

import Link from "next/link";
import { useState } from "react";
import {
  formatMockTimestamp,
  getContentAuditEvents,
  MOCK_DATA_NOTICE,
  useDemoWorkspace,
} from "@/lib/mock-data";
import { contentStatusLabel } from "@/lib/workflow";

const ACTION_LABELS: Record<string, string> = {
  created: "Draft created",
  draft_edited: "Draft edited",
  draft_reset: "Draft reset",
  reviewed: "Demonstration review run",
  finding_accepted: "Finding accepted",
  finding_edited: "Finding edited",
  finding_dismissed: "Finding dismissed",
  submitted: "Submitted for review",
  resubmitted: "Resubmitted for review",
  review_comment_added: "Review comment added",
  changes_requested: "Changes requested",
  approved: "Approved",
  ready_to_publish: "Ready to publish",
};

const ACTION_DESCRIPTIONS: Record<string, string> = {
  created: "created a draft",
  draft_edited: "edited the draft",
  draft_reset: "reset the draft",
  reviewed: "ran the demonstration review",
  finding_accepted: "accepted a suggested correction",
  finding_edited: "replaced the flagged text with a custom correction",
  finding_dismissed: "dismissed a finding",
  submitted: "submitted the document for review",
  resubmitted: "resubmitted the document for review",
  review_comment_added: "added a review comment",
  changes_requested: "requested changes",
  approved: "approved the content",
  ready_to_publish: "marked the content Ready to publish",
};

export default function AuditPage() {
  const workspace = useDemoWorkspace();
  const [selectedContentId, setSelectedContentId] = useState("all");
  const selectedDocument =
    selectedContentId === "all"
      ? undefined
      : workspace.documents.find((document) => document.id === Number(selectedContentId));
  const events =
    selectedContentId === "all"
      ? [...workspace.history].sort(
          (left, right) =>
            left.at.localeCompare(right.at) || left.id - right.id,
        )
      : selectedDocument
        ? getContentAuditEvents(workspace, selectedDocument.id)
        : [];
  const reviewCount = events.filter((entry) => entry.action === "reviewed").length;

  return (
    <section className="page">
      <div>
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Audit Trail</h1>
        <p className="lead">
          Chronological demonstration activity. Events are shown oldest first; equal timestamps are ordered by their stable event ID.
        </p>
      </div>
      <p className="mock-data-notice" role="note">
        {MOCK_DATA_NOTICE} Actors are the demo role identities selected when an action was made, not authenticated users.
      </p>

      {workspace.persistenceWarning && (
        <p className="form-error" role="alert">
          Audit history could not be loaded or saved in this browser: {workspace.persistenceWarning}
        </p>
      )}

      <label className="form-field audit-filter" htmlFor="audit-content-filter">
        Filter timeline by content
        <select
          id="audit-content-filter"
          value={selectedContentId}
          onChange={(event) => setSelectedContentId(event.target.value)}
          disabled={!workspace.isHydrated}
        >
          <option value="all">All content</option>
          {workspace.documents.map((document) => (
            <option key={document.id} value={document.id}>
              #{document.id} · {document.title}
            </option>
          ))}
        </select>
      </label>

      {selectedDocument && (
        <section className="card mock-history-summary" aria-labelledby="history-document-heading">
          <div>
            <p className="eyebrow">Document #{selectedDocument.id}</p>
            <h2 id="history-document-heading">{selectedDocument.title}</h2>
            <p className="muted">Current status: {contentStatusLabel(selectedDocument.status)}</p>
          </div>
          <div className="mock-history-count">
            <strong>{reviewCount}</strong>
            <span>demonstration review runs</span>
          </div>
          <Link href="/editor" className="button button-primary">
            Open in Write &amp; Review
          </Link>
        </section>
      )}

      {events.length === 0 ? (
        <div className="card empty-state">
          <h2>{workspace.isHydrated ? "No audit events for this content" : "Loading audit history"}</h2>
          <p className="muted">
            {workspace.isHydrated
              ? "Successful actions for this item will appear here as the shared demonstration history."
              : "The browser-local demonstration history is being loaded."}
          </p>
        </div>
      ) : (
        <ol className="mock-history-list" aria-label="Chronological audit timeline">
          {events.map((entry) => {
            const document = workspace.documents.find(
              (item) => item.id === entry.content_id,
            );
            const eventLabel = ACTION_LABELS[entry.action] ?? entry.action.replaceAll("_", " ");
            const description = ACTION_DESCRIPTIONS[entry.action] ?? entry.detail;
            return (
            <li className="mock-history-item" key={entry.id}>
              <time dateTime={entry.at}>{formatMockTimestamp(entry.at)}</time>
              <div>
                <span className="audit-event-type">{eventLabel}</span>
                <h2>
                  {entry.actor} {description}.
                </h2>
                <p>{entry.detail}</p>
                <p className="muted">
                  {entry.content_title || document?.title || `Document #${entry.content_id}`}
                  {" · Document #"}{entry.content_id} · {entry.actor} ·{" "}
                  {entry.role.replaceAll("_", " ")}
                </p>
                {entry.finding_id !== undefined && (
                  <p>
                    Finding #{entry.finding_id}:{" "}
                    <Link href={`/editor#finding-card-${entry.finding_id}`}>
                      {entry.finding_title || "Open finding in Write & Review"}
                    </Link>
                  </p>
                )}
                {entry.changes && entry.changes.length > 0 && (
                  <dl className="audit-changes">
                    {entry.changes.map((change, index) => (
                      <div key={`${change.field}-${index}`}>
                        <dt>{change.field === "text" ? "Finding text" : change.field}</dt>
                        <dd>
                          <span>Previous: </span>
                          <q>{change.previous ?? "—"}</q>
                          <span> · New: </span>
                          <q>{change.next ?? "—"}</q>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {entry.comment && (
                  <blockquote className="audit-comment">{entry.comment}</blockquote>
                )}
              </div>
            </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
