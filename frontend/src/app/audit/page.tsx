"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import EmptyState from "@/components/EmptyState";
import { ApiError, api } from "@/lib/api";
import { useRole } from "@/lib/role";
import type { Content, ContentAuditEvent } from "@/lib/types";

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : "The request could not be completed.";
}

export default function AuditPage() {
  const { isRoleLoaded } = useRole();
  const [events, setEvents] = useState<ContentAuditEvent[]>([]);
  const [documents, setDocuments] = useState<Content[]>([]);
  const [selectedId, setSelectedId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [audit, content] = await Promise.all([api.getAudit(), api.listContent()]);
      setEvents(audit);
      setDocuments(content);
      setError("");
    } catch (cause) {
      setEvents([]);
      setDocuments([]);
      setError(messageFor(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isRoleLoaded) void load();
  }, [isRoleLoaded, load]);

  const visibleEvents = events.filter(
    (event) => selectedId === "all" || event.content_id === Number(selectedId),
  );
  const contentById = new Map(documents.map((item) => [item.id, item]));

  return (
    <section className="page">
      <div>
        <p className="eyebrow">CoRESpace / Reviews</p>
        <h1>Audit Trail</h1>
        <p className="lead">Chronological activity recorded by the backend.</p>
      </div>
      {error && <div className="form-error" role="alert"><p>{error}</p><button className="button" type="button" onClick={() => void load()}>Retry</button></div>}
      <label className="form-field audit-filter" htmlFor="audit-content-filter">
        Filter timeline by content
        <select id="audit-content-filter" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={loading}>
          <option value="all">All content</option>
          {documents.map((document) => <option key={document.id} value={document.id}>#{document.id} · {document.title}</option>)}
        </select>
      </label>
      {loading ? (
        <p className="editor-notice" role="status">Loading audit events from the backend...</p>
      ) : visibleEvents.length === 0 ? (
        <EmptyState
          title={error ? "Audit history unavailable" : "No audit events are available"}
          description={error ? "The backend did not return audit history. Retry when the API is available." : "Events will appear here after content is created or workflow actions are performed."}
          action={<Link href="/editor" className="button button-primary">Open Write &amp; Review</Link>}
        />
      ) : (
        <ol className="mock-history-list" aria-label="Backend audit timeline">
          {visibleEvents.map((event) => {
            const content = event.content_id === null ? undefined : contentById.get(event.content_id);
            const details = event.details;
            const transition = typeof details.previous_status === "string" && typeof details.new_status === "string"
              ? ` (${details.previous_status.replaceAll("_", " ")} → ${details.new_status.replaceAll("_", " ")})`
              : "";
            return (
              <li className="mock-history-item" key={event.id}>
                <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
                <div>
                  <span className="audit-event-type">{event.action.replaceAll("_", " ")}</span>
                  <h2>{event.actor} recorded {event.action.replaceAll("_", " ")}{transition}.</h2>
                  <p className="muted">
                    {content?.title ?? `Content #${event.content_id ?? "workspace"}`}
                    {event.content_id !== null ? ` · Content #${event.content_id}` : ""}
                    {" · "}Actor: {event.actor}
                  </p>
                  {event.content_id !== null && (
                    <Link href={`/editor?id=${event.content_id}`}>Inspect content</Link>
                  )}
                  {typeof details.comment_id === "number" && <p>Comment #{details.comment_id} saved.</p>}
                  {typeof details.previous_version === "number" && typeof details.new_version === "number" && (
                    <p>Content version {details.previous_version} → {details.new_version}</p>
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
