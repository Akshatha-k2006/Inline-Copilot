"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { ApiError, api } from "@/lib/api";
import { useRole } from "@/lib/role";
import type {
  BackendFinding,
  Content,
  ContentAuditEvent,
  ContentFindingsResponse,
  ReviewComment,
} from "@/lib/types";
import { canEditContent, contentStatusLabel } from "@/lib/workflow";

const CONTENT_TYPES = [
  ["marketing_copy", "Marketing copy"],
  ["blog_post", "Blog post"],
  ["social_media", "Social media"],
  ["email", "Email"],
  ["other", "Other"],
] as const;

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function Editor() {
  const { role, user, isRoleLoaded } = useRole();

  const [documents, setDocuments] = useState<Content[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Content | null>(null);
  const [findingsData, setFindingsData] =
    useState<ContentFindingsResponse | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [audit, setAudit] = useState<ContentAuditEvent[]>([]);

  const [loadingList, setLoadingList] = useState(true);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<string>(CONTENT_TYPES[0][0]);
  const [body, setBody] = useState("");
  const [replacements, setReplacements] = useState<Record<number, string>>({});

  const actionInFlight = useRef(false);
  const selectedLoadId = useRef(0);
  const listLoadId = useRef(0);

  const loadList = useCallback(async () => {
    const requestId = ++listLoadId.current;
    setLoadingList(true);

    try {
      const result = await api.listContent();
      if (requestId === listLoadId.current) {
        setDocuments(result);
        setError("");
      }
    } catch (cause) {
      if (requestId === listLoadId.current) {
        setError(messageFor(cause));
        setDocuments([]);
      }
    } finally {
      if (requestId === listLoadId.current) setLoadingList(false);
    }
  }, []);

  const loadSelected = useCallback(async (id: number) => {
    const requestId = ++selectedLoadId.current;
    setLoadingSelected(true);

    try {
      const [content, findings, commentData, events] = await Promise.all([
        api.getContent(id),
        api.getContentFindings(id),
        api.getReviewComments(id),
        api.getContentAudit(id),
      ]);

      if (requestId !== selectedLoadId.current) return;

      setSelected(content);
      setTitle(content.title);
      setContentType(content.content_type);
      setBody(content.body);
      setFindingsData(findings);
      setComments(commentData.comments);
      setAudit(events);
      setReplacements({});
      setError("");
    } catch (cause) {
      if (requestId !== selectedLoadId.current) return;
      setSelected(null);
      setError(messageFor(cause));
    } finally {
      if (requestId === selectedLoadId.current) setLoadingSelected(false);
    }
  }, []);

  useEffect(() => {
    if (!isRoleLoaded) return;
    void loadList();
  }, [isRoleLoaded, loadList, role]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = Number(params.get("id"));

    setCreating(params.get("new") === "1");
    setSelectedId(Number.isSafeInteger(id) && id > 0 ? id : null);
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      void loadSelected(selectedId);
    } else {
      selectedLoadId.current += 1;
      setSelected(null);
      setFindingsData(null);
      setComments([]);
      setAudit([]);
      setLoadingSelected(false);
    }
  }, [selectedId, loadSelected]);

  const mayEdit = selected ? canEditContent(role, user, selected) : false;
  const isOwner = Boolean(
    selected && selected.created_by === user.replace(/\s+\([^)]*\)$/, ""),
  );
  const isLocked = Boolean(selected && !mayEdit);
  const findings = findingsData?.findings ?? [];
  const currentFindings = findings.filter(
    (finding) =>
      finding.content_version === undefined ||
      finding.content_version === selected?.version,
  );
  const statusLabel = selected ? contentStatusLabel(selected.status) : "";
  const canCreate = role === "creator";
  const reviewIsCurrent = findingsData?.reviewed_version === selected?.version;
  const activeHighFindings = currentFindings.filter(
    (finding) => finding.status === "open" && finding.severity === "high",
  );

  function openDocument(id: number) {
    window.history.pushState({}, "", `/editor?id=${id}`);
    setCreating(false);
    setSelectedId(id);
    setError("");
    setMessage("");
  }

  function openCreateForm() {
    window.history.pushState({}, "", "/editor?new=1");
    setSelectedId(null);
    setSelected(null);
    setCreating(true);
    setTitle("");
    setContentType(CONTENT_TYPES[0][0]);
    setBody("");
    setFindingsData(null);
    setComments([]);
    setAudit([]);
    setError("");
    setMessage("");
  }

  function returnToList() {
    window.history.pushState({}, "", "/editor");
    setSelectedId(null);
    setCreating(false);
    setSelected(null);
    setError("");
    setMessage("");
  }

  async function refreshSelected(id: number) {
    await Promise.all([loadSelected(id), loadList()]);
  }

  async function exclusive(action: () => Promise<void>) {
    if (actionInFlight.current) return;

    actionInFlight.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await action();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function createContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !contentType || !body.trim()) {
      setError("Enter a title, content type, and content body.");
      return;
    }

    await exclusive(async () => {
      const created = await api.createContent({
        title: title.trim(),
        content_type: contentType,
        body: body.trim(),
      });

      setCreating(false);
      setSelectedId(created.id);
      window.history.replaceState({}, "", `/editor?id=${created.id}`);
      await loadList();
      setMessage("Content created successfully and saved to the backend.");
    });
  }

  async function saveDraft() {
    if (!selected || !mayEdit) return;

    await exclusive(async () => {
      await api.updateContent(selected.id, {
        title: title.trim(),
        content_type: contentType,
        body,
        version: selected.version,
      });
      await refreshSelected(selected.id);
    });
  }

  async function reviewAndCheck() {
    if (!selected || !mayEdit) return;

    await exclusive(async () => {
      let current = selected;

      if (
        current.title !== title.trim() ||
        current.content_type !== contentType ||
        current.body !== body
      ) {
        current = await api.updateContent(current.id, {
          title: title.trim(),
          content_type: contentType,
          body,
          version: current.version,
        });
      }

      await api.reviewContent(current.id);
      await refreshSelected(current.id);

      // Refresh first so the self-check runs against the latest persisted version.
      await api.selfCheckContent(current.id);
      await refreshSelected(current.id);
    });
  }

  async function submitForReview() {
    if (!selected || selected.status !== "self_checked") return;

    await exclusive(async () => {
      await api.submitContent(selected.id);
      await refreshSelected(selected.id);
    });
  }

  async function updateFinding(
    finding: BackendFinding,
    action: "accept" | "dismiss" | "edit",
  ) {
    if (!selected || !mayEdit) return;

    const replacement = replacements[finding.id]?.trim();

    if (action === "edit" && !replacement) {
      setError("Enter a replacement before saving the correction.");
      return;
    }

    await exclusive(async () => {
      await api.updateFinding(finding.id, {
        action,
        ...(action === "edit" ? { replacement } : {}),
      });
      await refreshSelected(selected.id);
    });
  }

  return (
    <section className="editor-page">
      <header className="editor-page-heading">
        <div>
          <p className="eyebrow">CoRESpace / Workspace</p>
          <h1>Write &amp; Review</h1>
          <p className="lead">
            Create and manage content using the connected workspace API.
          </p>
        </div>

        <div className="editor-buttons">
          <Link href="/" className="button">
            Back to dashboard
          </Link>
          {canCreate && (
            <button
              type="button"
              className="button button-primary"
              onClick={openCreateForm}
              disabled={busy}
            >
              Create Content
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="button"
            onClick={() => {
              if (selectedId !== null) void refreshSelected(selectedId);
              else void loadList();
            }}
          >
            Retry
          </button>
        </div>
      )}
      {message && (
        <p className="editor-notice" role="status">
          {message}
        </p>
      )}

      {loadingList ? (
        <p className="editor-notice" role="status">
          Loading content from the backend...
        </p>
      ) : (
        <nav className="entry-list" aria-label="Your content">
          {documents.map((document) => (
            <article className="entry-card" key={document.id}>
              <div className="entry-content">
                <p className="eyebrow">Content #{document.id}</p>
                <h2>{document.title}</h2>
                <div className="fact-meta">
                  <span className={`content-status status-${document.status}`}>
                    {contentStatusLabel(document.status)}
                  </span>
                  <span>Version {document.version}</span>
                  <span>{document.content_type.replaceAll("_", " ")}</span>
                </div>
              </div>
              <button
                type="button"
                className="button"
                onClick={() => openDocument(document.id)}
              >
                {selectedId === document.id
                  ? "Open content"
                  : "Inspect content"}
              </button>
            </article>
          ))}

          {documents.length === 0 && !creating && (
            <div className="empty-state">
              <h2>No content yet</h2>
              <p>Create a content item to start the review workflow.</p>
            </div>
          )}
        </nav>
      )}

      {creating ? (
        <form
          className="editor-card compose-panel"
          onSubmit={(event) => void createContent(event)}
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">New content</p>
              <h2>Create Content</h2>
            </div>
          </div>

          <div className="editor-fields">
            <label className="form-field" htmlFor="new-content-title">
              Title
              <input
                id="new-content-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={250}
              />
            </label>

            <label className="form-field" htmlFor="new-content-type">
              Content type
              <select
                id="new-content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
                required
              >
                {CONTENT_TYPES.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field" htmlFor="new-content-body">
              Content
              <textarea
                id="new-content-body"
                className="draft-textarea"
                rows={14}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
              />
            </label>
          </div>

          <div className="editor-controls">
            <span className="character-count">
              {body.length.toLocaleString()} characters
            </span>
            <div className="editor-buttons">
              <button
                type="button"
                className="button"
                onClick={returnToList}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !title.trim() || !body.trim()}
              >
                {busy ? "Creating..." : "Create Content"}
              </button>
            </div>
          </div>
        </form>
      ) : selectedId !== null ? (
        loadingSelected ? (
          <p className="editor-notice" role="status">
            Loading content, findings, comments, and audit history...
          </p>
        ) : selected ? (
          <>
            <div className="workflow-status-line">
              <span className={`content-status status-${selected.status}`}>
                {statusLabel}
              </span>
              <span>Version {selected.version}</span>
              <span>Updated {formatDate(selected.updated_at)}</span>
              <span>Created by {selected.created_by}</span>
            </div>

            {isLocked && (
              <p className="editor-notice" role="note">
                This item is read-only for your role or current workflow status.{" "}
                {selected.status === "approved" ||
                selected.status === "ready_to_publish"
                  ? "Approved content cannot be edited by creators; you can inspect it here or create a new item."
                  : selected.status === "in_review"
                    ? "This content is awaiting a reviewer decision. You can inspect it or create a separate draft."
                    : "Only its creator can edit an eligible draft."}
              </p>
            )}

            <div className="editor-layout">
              <section
                className="editor-card compose-panel"
                aria-labelledby="compose-heading"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Content #{selected.id}</p>
                    <h2 id="compose-heading">Content details</h2>
                  </div>
                  <span>Version {selected.version}</span>
                </div>

                <div className="editor-fields">
                  <label className="form-field" htmlFor="content-title">
                    Title
                    <input
                      id="content-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      readOnly={!mayEdit}
                    />
                  </label>

                  <label className="form-field" htmlFor="content-type">
                    Content type
                    <select
                      id="content-type"
                      value={contentType}
                      onChange={(event) => setContentType(event.target.value)}
                      disabled={!mayEdit}
                    >
                      {CONTENT_TYPES.map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                      {!CONTENT_TYPES.some(
                        ([value]) => value === contentType,
                      ) && <option value={contentType}>{contentType}</option>}
                    </select>
                  </label>

                  <label className="form-field" htmlFor="content-body">
                    Content
                    <textarea
                      id="content-body"
                      className="draft-textarea"
                      rows={14}
                      value={body}
                      onChange={(event) => setBody(event.target.value)}
                      readOnly={!mayEdit}
                    />
                  </label>
                </div>

                <div className="editor-controls">
                  <span className="character-count">
                    {body.length.toLocaleString()} characters
                  </span>
                  {mayEdit && (
                    <div className="editor-buttons">
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void saveDraft()}
                        disabled={busy || !title.trim() || !body.trim()}
                      >
                        {busy ? "Saving..." : "Save draft"}
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => void reviewAndCheck()}
                        disabled={busy || !body.trim() || !title.trim()}
                      >
                        {busy ? "Checking..." : "Run review checks"}
                      </button>
                    </div>
                  )}
                </div>

                {role === "creator" &&
                  isOwner &&
                  selected.status === "self_checked" && (
                    <section className="workflow-action-card">
                      <h3>Ready to submit</h3>
                      <p>
                        The backend review is current. Resolve open
                        high-severity findings before submission.
                      </p>
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void submitForReview()}
                        disabled={
                          busy ||
                          !reviewIsCurrent ||
                          activeHighFindings.length > 0
                        }
                      >
                        {busy ? "Submitting..." : "Submit for review"}
                      </button>
                    </section>
                  )}
              </section>

              <section
                className="editor-card findings-panel"
                aria-labelledby="findings-heading"
              >
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Backend review results</p>
                    <h2 id="findings-heading">Findings</h2>
                  </div>
                </div>

                {!findingsData || findingsData.reviewed_version === null ? (
                  <p className="muted">
                    No review has been run for this content.
                  </p>
                ) : !reviewIsCurrent ? (
                  <p className="editor-notice" role="status">
                    These findings are for version{" "}
                    {findingsData.content_version}; the current content is
                    version {selected.version}. Run review checks again.
                  </p>
                ) : currentFindings.length === 0 ? (
                  <p className="editor-notice" role="status">
                    The backend review returned no findings for this version.
                  </p>
                ) : (
                  <div className="finding-list">
                    {currentFindings.map((finding) => {
                      const matchedText = finding.evidence?.matched_text ?? "";

                      return (
                        <article
                          className={`finding-card severity-${finding.severity}`}
                          key={finding.id}
                        >
                          <div className="finding-heading">
                            <div>
                              <span
                                className={`severity-badge severity-badge-${finding.severity}`}
                              >
                                {finding.severity}
                              </span>
                              <h3>{finding.check.replaceAll("_", " ")}</h3>
                            </div>
                            <span
                              className={`finding-status status-${finding.status}`}
                            >
                              {finding.status.replaceAll("_", " ")}
                            </span>
                          </div>

                          <p>{finding.message}</p>
                          {matchedText && (
                            <p>
                              <strong>Matched text:</strong>{" "}
                              <q>{matchedText}</q>
                            </p>
                          )}
                          {finding.suggested_fix && (
                            <p>
                              <strong>Suggested correction:</strong>{" "}
                              {finding.suggested_fix}
                            </p>
                          )}

                          {finding.status === "open" &&
                            mayEdit &&
                            selected.status === "draft" && (
                              <>
                                <label
                                  className="form-field"
                                  htmlFor={`finding-replacement-${finding.id}`}
                                >
                                  Custom correction
                                  <textarea
                                    id={`finding-replacement-${finding.id}`}
                                    rows={2}
                                    value={replacements[finding.id] ?? ""}
                                    onChange={(event) =>
                                      setReplacements((existing) => ({
                                        ...existing,
                                        [finding.id]: event.target.value,
                                      }))
                                    }
                                  />
                                </label>
                                <div className="finding-actions">
                                  <button
                                    type="button"
                                    className="button"
                                    onClick={() =>
                                      void updateFinding(finding, "accept")
                                    }
                                    disabled={busy || !finding.suggested_fix}
                                  >
                                    Accept suggestion
                                  </button>
                                  <button
                                    type="button"
                                    className="button"
                                    onClick={() =>
                                      void updateFinding(finding, "edit")
                                    }
                                    disabled={
                                      busy || !replacements[finding.id]?.trim()
                                    }
                                  >
                                    Save correction
                                  </button>
                                  <button
                                    type="button"
                                    className="button"
                                    onClick={() =>
                                      void updateFinding(finding, "dismiss")
                                    }
                                    disabled={busy}
                                  >
                                    Dismiss
                                  </button>
                                </div>
                              </>
                            )}
                        </article>
                      );
                    })}
                  </div>
                )}

                {activeHighFindings.length > 0 && (
                  <ul className="workflow-blockers">
                    <li>
                      {activeHighFindings.length} open high-severity finding(s)
                      must be resolved before submission.
                    </li>
                  </ul>
                )}
              </section>
            </div>

            <section
              className="card workflow-comments"
              aria-labelledby="comments-heading"
            >
              <h2 id="comments-heading">Review comments</h2>
              {comments.length === 0 ? (
                <p className="muted">No persisted review comments.</p>
              ) : (
                <ul>
                  {comments.map((comment) => (
                    <li key={comment.id}>
                      <p>{comment.body}</p>
                      <small>
                        {comment.author} · {formatDate(comment.created_at)}
                      </small>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section
              className="card workflow-comments"
              aria-labelledby="audit-heading"
            >
              <h2 id="audit-heading">Recent backend activity</h2>
              {audit.length === 0 ? (
                <p className="muted">
                  No audit events have been recorded for this item.
                </p>
              ) : (
                <ol>
                  {audit
                    .slice(-5)
                    .reverse()
                    .map((event: ContentAuditEvent) => (
                      <li key={event.id}>
                        <p>{event.action.replaceAll("_", " ")}</p>
                        <small>
                          {event.actor} · {formatDate(event.created_at)}
                        </small>
                      </li>
                    ))}
                </ol>
              )}
            </section>
          </>
        ) : (
          <div className="empty-state" role="alert">
            <h2>Content could not be opened</h2>
            <p>Confirm the content ID and your role permissions, then retry.</p>
          </div>
        )
      ) : (
        <div className="empty-state">
          <h2>Select content to inspect</h2>
          <p>
            Previously submitted and approved content remains available for
            inspection.
          </p>
        </div>
      )}

      {selected && selected.status === "in_review" && role === "creator" && (
        <p className="editor-notice" role="note">
          The content is with a reviewer. Create another content item while
          this one is under review.
        </p>
      )}

      {selected &&
        (selected.status === "approved" ||
          selected.status === "ready_to_publish") && (
          <p className="editor-notice" role="note">
            {selected.status === "approved"
              ? "A Brand Manager or Admin may move approved content to ready to publish."
              : "This content is ready to publish. Creator editing is disabled."}
          </p>
        )}

      {selected && (
        <p className="muted">
          {comments.length} persisted comment(s) · {audit.length} persisted
          audit event(s)
        </p>
      )}

      <div className="editor-buttons">
        {(selectedId !== null || creating) && (
          <button
            type="button"
            className="button"
            onClick={returnToList}
            disabled={busy}
          >
            Return to content list
          </button>
        )}
      </div>
    </section>
  );
}
