"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRole } from "@/lib/role";
import {
  createDocument as createBackendDocument,
  deleteDocument as deleteBackendDocument,
  getDocumentFindings,
  resolveFinding,
  runContentReview,
  refreshWorkspace,
  saveDraft,
  submitDocument,
  useWorkspace,
} from "@/lib/workspace-store";
import type { DemoFinding } from "@/lib/findings";
import type { Content, EvidenceRequest, FindingStatus } from "@/lib/types";
import { formatTimestamp } from "@/lib/format";
import { contentStatusLabel } from "@/lib/workflow";
import { api } from "@/lib/api";
import FindingsPanel from "./FindingsPanel";
import HighlightedDraft from "./HighlightedDraft";
import ImageAccessibilityPanel from "./ImageAccessibilityPanel";

const DRAFT_BODY_PLACEHOLDER = "Start writing your on-brand content here.";

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function hasPendingChangesRequest(
  history: {
    content_id: number | null;
    action: string;
    status_change?: {
      previous: string | null;
      next: string | null;
      actor_role: string | null;
    };
  }[],
  document: Content,
): boolean {
  if (document.status !== "draft") return false;
  const events = history.filter((entry) => entry.content_id === document.id);
  let sentBackAt = -1;
  events.forEach((entry, index) => {
    if (
      entry.action === "content_status_changed" &&
      entry.status_change?.next === "draft" &&
      entry.status_change.actor_role === "reviewer"
    ) {
      sentBackAt = index;
    }
  });
  if (sentBackAt === -1) return false;
  // Saving an edit after a reviewer sent the draft back means the creator is
  // addressing the feedback; resubmission is allowed once that version is
  // reviewed again.
  return !events
    .slice(sentBackAt + 1)
    .some((entry) => entry.action === "content_updated");
}

export default function Editor() {
  const { role } = useRole();
  const workspace = useWorkspace();
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(
    null,
  );
  const visibleDocuments =
    role === "creator"
      ? workspace.documents
      : workspace.documents.filter(
          (item) =>
            item.status === "in_review" ||
            item.status === "changes_requested" ||
            item.status === "approved" ||
            item.status === "rejected" ||
            item.status === "ready_to_publish",
        );
  const document =
    visibleDocuments.find((item) => item.id === selectedDocumentId) ??
    visibleDocuments[0] ??
    workspace.documents.find((item) => item.id === selectedDocumentId);
  const [title, setTitle] = useState(document?.title ?? "");
  const [body, setBody] = useState(document?.body ?? "");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("Untitled document");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNotice, setReviewNotice] = useState("");
  const [busyFindingIds, setBusyFindingIds] = useState<number[]>([]);
  const [evidenceRequests, setEvidenceRequests] = useState<EvidenceRequest[]>(
    [],
  );
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState("");
  const [showHighlights, setShowHighlights] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newTitleInputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const findings = document ? getDocumentFindings(workspace, document.id) : [];
  const documentComments = document
    ? workspace.comments.filter(
        (comment) => comment.document_id === document.id,
      )
    : [];
  const changesRequested = document
    ? hasPendingChangesRequest(workspace.history, document)
    : false;
  const reviewState =
    document &&
    document.reviewed_version === document.version &&
    body === document.body
      ? "current"
      : document && document.reviewed_version !== null
        ? "stale"
        : "not-run";
  const canEdit = role === "creator" && document?.status === "draft";
  const openCount = findings.filter(
    (finding) => finding.status === "open",
  ).length;
  const canSubmit =
    role === "creator" &&
    document !== undefined &&
    !changesRequested &&
    (document.status === "self_checked" ||
      (canEdit && reviewState === "current" && openCount === 0));
  const readingTime = Math.max(
    1,
    Math.ceil(body.trim().split(/\s+/).filter(Boolean).length / 200),
  );

  useEffect(() => {
    if (selectedDocumentId !== null) return;
    const requestedId = Number(
      new URLSearchParams(window.location.search).get("id"),
    );
    const requestedDocument = Number.isInteger(requestedId)
      ? workspace.documents.find((item) => item.id === requestedId)
      : undefined;
    if (requestedDocument) {
      setSelectedDocumentId(requestedDocument.id);
    } else if (workspace.documents[0]) {
      setSelectedDocumentId(workspace.documents[0].id);
    }
  }, [selectedDocumentId, workspace.documents]);

  useEffect(() => {
    setTitle(document?.title ?? "");
    setBody(document?.body ?? "");
  }, [document?.id, document?.updated_at]);

  useEffect(() => {
    setReviewNotice("");
    setShowHighlights(false);
  }, [document?.id]);

  useEffect(() => {
    if (!document || !workspace.isLoaded) return;
    let active = true;
    setEvidenceLoading(true);
    setEvidenceError("");
    void api
      .listEvidenceRequests()
      .then((requests) => {
        if (active) setEvidenceRequests(requests);
      })
      .catch((cause: unknown) => {
        if (active) {
          setEvidenceError(
            cause instanceof Error
              ? cause.message
              : "Evidence requests could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setEvidenceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [document?.id, workspace.isLoaded]);

  // Success notices are transient: they clear themselves after a few seconds.
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!reviewNotice) return;
    const timer = window.setTimeout(() => setReviewNotice(""), 5000);
    return () => window.clearTimeout(timer);
  }, [reviewNotice]);

  async function run(
    action: () => Promise<void>,
    success: string,
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      setMessage(success);
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The action could not be completed.",
      );
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  function save(): Promise<void> {
    if (!document || !canEdit) return Promise.resolve();
    return run(async () => {
      const saved = await saveDraft(document.id, title, body, role);
      setTitle(saved.title);
      setBody(saved.body);
    }, "Draft saved to the backend.");
  }

  function saveContrast(
    foregroundColor: string | null,
    backgroundColor: string | null,
    textSize: "normal" | "large" | null,
  ): Promise<void> {
    if (!document || !canEdit) return Promise.resolve();
    return run(async () => {
      await saveDraft(document.id, title, body, role, {
        foreground_color: foregroundColor,
        background_color: backgroundColor,
        text_size: textSize,
      });
    }, "Color settings saved. Run review to check contrast.");
  }

  async function recheckAccessibility(finding: DemoFinding): Promise<void> {
    if (!document) return;
    await run(async () => {
      const response = await api.recheckAccessibilityFinding(
        document.id,
        finding.id,
      );
      await refreshWorkspace();
      setReviewNotice(
        response.finding.status === "resolved"
          ? "Accessibility issue resolved."
          : "Accessibility issue remains. Review the updated suggestion.",
      );
    }, "Accessibility check completed.");
  }

  function editAccessibility(finding: DemoFinding): void {
    const imageId = finding.accessibility?.image_id;
    if (!imageId) return;
    globalThis.document
      .getElementById(`alt-text-${imageId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => {
      globalThis.document.getElementById(`alt-text-${imageId}`)?.focus();
    }, 250);
  }

  function reviewDraft(): Promise<void> {
    if (!document || !canEdit || reviewing) return Promise.resolve();
    return run(async () => {
      setReviewing(true);
      setReviewNotice("");
      try {
        let current = document;
        if (title !== document.title || body !== document.body) {
          current = await saveDraft(document.id, title, body, role);
        }
        const response = await runContentReview(current.id, role);
        setSelectedId(null);
      } finally {
        setReviewing(false);
      }
    }, "Full review completed.");
  }

  function resolve(
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
  ): Promise<void> {
    if (!document) return Promise.resolve();
    return run(
      async () => {
        setBusyFindingIds((ids) => [...ids, finding.id]);
        try {
          await resolveFinding(finding.id, status, finalText, role);
        } finally {
          setBusyFindingIds((ids) => ids.filter((id) => id !== finding.id));
        }
      },
      status === "dismissed"
        ? "Finding dismissed and recorded in the audit trail."
        : "Finding resolved.",
    );
  }

  function requestEvidence(
    finding: DemoFinding,
    reason: string,
    assignee: string,
  ): Promise<void> {
    return api
      .createEvidenceRequest({
        claimText: finding.text,
        findingId: finding.id,
        reason,
        assignee,
      })
      .then((request) => {
        setEvidenceRequests((requests) => [...requests, request]);
      });
  }

  function submit(): Promise<void> {
    if (!document) return Promise.resolve();
    return run(async () => {
      await submitDocument(document.id, role);
    }, "Draft submitted for review.");
  }

  function createDocument(): Promise<void> {
    return run(async () => {
      const created = await createBackendDocument(
        newTitle.trim() || "Untitled document",
        "",
        role,
      );
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

  function removeDocument(): void {
    if (!document) return;
    if (!globalThis.confirm("Delete this draft?")) return;
    void run(async () => {
      await deleteBackendDocument(document.id, role);
      const fallback = workspace.documents.find(
        (item) => item.id !== document.id,
      );
      setSelectedDocumentId(fallback?.id ?? null);
    }, "Document deleted.");
  }

  const onSelect = (finding: DemoFinding) => {
    setSelectedId(finding.id);
    if (canEdit && openCount > 0 && reviewState === "current") {
      setShowHighlights(true);
    }
    window.setTimeout(() => {
      globalThis.document
        .getElementById(`draft-highlight-${finding.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };

  const statusNotice =
    !workspace.isLoaded && workspace.isLoading
      ? "Loading workspace from the backend..."
      : !workspace.isLoaded && workspace.error
        ? `The backend workspace could not be loaded: ${workspace.error}`
        : "";

  if (!document && role === "creator")
    return (
      <section className="page editor-page">
        <header className="editor-header">
          <div>
            <p className="eyebrow">CoRESpace / Inline Editor</p>
            <h1>Write with confidence</h1>
            <p className="lead">
              Review exact phrases against approved brand knowledge before
              sharing your work.
            </p>
          </div>
        </header>
        {statusNotice && (
          <p className="editor-notice" role="status">
            {statusNotice}
          </p>
        )}
        {message && (
          <p className="editor-notice" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="editor-layout">
          <aside className="editor-document-list card">
            <div className="panel-heading doc-list-heading">
              <p className="eyebrow">
                My documents
                <span className="doc-count">{workspace.documents.length}</span>
              </p>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setCreating(true);
                  setSelectedDocumentId(null);
                  setNewTitle("Untitled document");
                  window.setTimeout(() => newTitleInputRef.current?.focus(), 0);
                }}
              >
                New
              </button>
            </div>
            <div className="document-list">
              {workspace.documents.map((item) => {
                const itemPending = hasPendingChangesRequest(
                  workspace.history,
                  item,
                );
                const itemState = itemPending
                  ? "changes_requested"
                  : item.status;
                const itemWords = countWords(item.body);
                return (
                  <button
                    className={`document-list-item doc-state-${itemState}`}
                    type="button"
                    key={item.id}
                    onClick={() => {
                      setSelectedDocumentId(item.id);
                      setCreating(false);
                    }}
                  >
                    <strong className="document-list-item-title">
                      {item.title}
                    </strong>
                    <span className="document-list-item-meta">
                      <span className="doc-state-dot" aria-hidden="true" />
                      <span className="doc-state-label">
                        {itemPending
                          ? "Changes requested"
                          : contentStatusLabel(item.status)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="doc-words">
                        {itemWords} {itemWords === 1 ? "word" : "words"}
                      </span>
                      <span className="doc-version">v{item.version}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="document-list-footer">
              <p className="muted">
                {workspace.documents.length} document
                {workspace.documents.length !== 1 ? "s" : ""}
              </p>
            </div>
          </aside>
          <section className="editor-main card">
            {creating ? (
              <>
                <div className="editor-toolbar">
                  <h2 style={{ margin: 0 }}>Create a new document</h2>
                </div>
                <div className="card inline-create" style={{ margin: 0 }}>
                  <p className="muted">
                    A new draft is saved to the backend and shared across the
                    demo roles.
                  </p>
                  <label className="form-field" style={{ width: "100%" }}>
                    <span>Title</span>
                    <input
                      ref={newTitleInputRef}
                      value={newTitle}
                      onChange={(event) => setNewTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void createDocument();
                        }
                      }}
                    />
                  </label>
                  <div className="form-actions">
                    <button
                      className="button button-primary"
                      type="button"
                      disabled={busy}
                      onClick={() => void createDocument()}
                    >
                      Create draft
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        setCreating(false);
                        setNewTitle("Untitled document");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="editor-toolbar">
                  <input
                    ref={titleInputRef}
                    aria-label="Document title"
                    className="title-input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    disabled
                    placeholder="Untitled document"
                  />
                </div>
                <textarea
                  aria-label="Document body"
                  className="document-editor"
                  value=""
                  disabled
                  placeholder={DRAFT_BODY_PLACEHOLDER}
                />
                <div className="editor-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => {
                      setCreating(true);
                      setSelectedDocumentId(null);
                      setNewTitle("Untitled document");
                      window.setTimeout(
                        () => newTitleInputRef.current?.focus(),
                        0,
                      );
                    }}
                  >
                    Create your first draft
                  </button>
                </div>
              </>
            )}
          </section>
          <div className="editor-side"></div>
        </div>
      </section>
    );

  if (!document && role !== "creator")
    return (
      <section className="page">
        {statusNotice && (
          <p className="editor-notice" role="status">
            {statusNotice}
          </p>
        )}
        <h1>No documents to review</h1>
        <p className="muted">No drafts have been submitted for review yet.</p>
        <Link className="button button-primary" href="/queue">
          Open review queue
        </Link>
      </section>
    );

  // Resolved findings stay in the findings list, but they must not keep the
  // creator locked in the read-only highlighted view. Editors can also switch
  // to highlights on demand instead of losing the ability to type.
  const showHighlighted =
    openCount > 0 &&
    reviewState === "current" &&
    body === document.body &&
    (showHighlights || !canEdit);

  return (
    <section className="page editor-page">
      <header className="editor-header">
        <div>
          <p className="eyebrow">CoRESpace / Inline Editor</p>
          <h1>Write with confidence</h1>
          <p className="lead">
            Review exact phrases against approved brand knowledge before sharing
            your work.
          </p>
        </div>
        <span
          className={`status-pill status-${creating ? "draft" : document.status}`}
        >
          {creating ? "New draft" : contentStatusLabel(document.status)}
        </span>
      </header>
      {statusNotice && (
        <p className="editor-notice" role="status">
          {statusNotice}
        </p>
      )}
      {message && (
        <p className="editor-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {reviewNotice && !error && (
        <p className="editor-notice" role="status">
          {reviewNotice}
        </p>
      )}
      {!creating && document && documentComments.length > 0 && (
        <section
          className="editor-card reviewer-feedback-card"
          aria-labelledby="reviewer-feedback-heading"
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Reviewer feedback</p>
              <h2 id="reviewer-feedback-heading">
                {changesRequested ? "Changes requested" : "Review notes"}
              </h2>
              <p className="reviewer-feedback-context">
                <strong>{document.title}</strong> · version {document.version} ·{" "}
                {documentComments.length} review{" "}
                {documentComments.length === 1 ? "note" : "notes"}
              </p>
              {changesRequested && (
                <p className="muted">
                  Address the feedback, run a full review, then submit the draft
                  again.
                </p>
              )}
            </div>
          </div>
          <div className="review-feedback-history">
            {documentComments.map((comment) => (
              <p key={comment.id}>
                <strong>{comment.author}</strong>
                <span>{comment.text}</span>
                <small>{formatTimestamp(comment.at)}</small>
              </p>
            ))}
          </div>
        </section>
      )}
      <div className="editor-layout">
        <aside className="editor-document-list card">
          <div className="panel-heading doc-list-heading">
            <p className="eyebrow">
              {role === "creator" ? "My documents" : "Submitted documents"}
              <span className="doc-count">{visibleDocuments.length}</span>
            </p>
            {role === "creator" && (
              <button
                className="button"
                type="button"
                onClick={() => {
                  setCreating(true);
                  setSelectedDocumentId(null);
                  setNewTitle("Untitled document");
                  window.setTimeout(() => newTitleInputRef.current?.focus(), 0);
                }}
              >
                New
              </button>
            )}
          </div>
          <div className="document-list">
            {visibleDocuments.map((item) => {
              const itemPending = hasPendingChangesRequest(
                workspace.history,
                item,
              );
              const itemState = itemPending ? "changes_requested" : item.status;
              const itemWords = countWords(item.body);
              return (
                <button
                  className={`document-list-item doc-state-${itemState}${!creating && item.id === document?.id ? " active" : ""}`}
                  type="button"
                  key={item.id}
                  onClick={() => {
                    setSelectedDocumentId(item.id);
                    setCreating(false);
                    if (canEdit) {
                      setTimeout(() => bodyRef.current?.focus(), 0);
                    }
                  }}
                >
                  <strong className="document-list-item-title">
                    {item.title}
                  </strong>
                  <span className="document-list-item-meta">
                    <span className="doc-state-dot" aria-hidden="true" />
                    <span className="doc-state-label">
                      {itemPending
                        ? "Changes requested"
                        : contentStatusLabel(item.status)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="doc-words">
                      {itemWords} {itemWords === 1 ? "word" : "words"}
                    </span>
                    <span className="doc-version">v{item.version}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {visibleDocuments.length === 0 && (
            <p className="muted">
              {role === "creator"
                ? "No documents yet."
                : "No submitted documents."}
            </p>
          )}
          <div className="document-list-footer">
            {!creating &&
              document &&
              role === "creator" &&
              document.status === "draft" && (
                <button
                  className="button button-danger"
                  type="button"
                  disabled={busy}
                  onClick={removeDocument}
                >
                  Delete draft
                </button>
              )}
          </div>
        </aside>
        <section className="editor-main card">
          {creating ? (
            <>
              <div className="editor-toolbar">
                <h2 style={{ margin: 0 }}>Create a new document</h2>
              </div>
              <div className="card inline-create" style={{ margin: 0 }}>
                <p className="muted">
                  A new draft is saved to the backend and shared across the demo
                  roles.
                </p>
                <label className="form-field" style={{ width: "100%" }}>
                  <span>Title</span>
                  <input
                    ref={newTitleInputRef}
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void createDocument();
                      }
                    }}
                  />
                </label>
                <div className="form-actions">
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void createDocument()}
                  >
                    Create draft
                  </button>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      if (document) {
                        setTitle(document.title);
                        setBody(document.body);
                      } else {
                        setSelectedDocumentId(
                          workspace.documents[0]?.id ?? null,
                        );
                      }
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="editor-toolbar">
                <input
                  ref={titleInputRef}
                  aria-label="Document title"
                  className="title-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={!canEdit}
                  placeholder="Untitled document"
                />
              </div>
              {showHighlighted ? (
                <HighlightedDraft
                  body={body}
                  findings={findings}
                  selectedFindingId={selectedId}
                  onSelect={onSelect}
                />
              ) : (
                <textarea
                  ref={bodyRef}
                  aria-label="Document body"
                  className="document-editor"
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  disabled={!canEdit}
                  spellCheck
                  placeholder={DRAFT_BODY_PLACEHOLDER}
                />
              )}
              {document && (
                <ImageAccessibilityPanel
                  contentId={document.id}
                  canEdit={canEdit}
                  foregroundColor={document.foreground_color}
                  backgroundColor={document.background_color}
                  textSize={document.text_size}
                  onSaveContrast={saveContrast}
                />
              )}
              <div className="editor-meta">
                <span>
                  {body.trim().split(/\s+/).filter(Boolean).length} words ·{" "}
                  {readingTime} min read
                </span>
                <span>
                  {reviewState === "current"
                    ? "Review is current"
                    : "Review needed"}
                </span>
              </div>
              <div className="editor-actions">
                {canEdit && (
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    Save draft
                  </button>
                )}
                {canEdit && (
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void reviewDraft()}
                  >
                    {reviewing ? "Reviewing..." : "Run full review"}
                  </button>
                )}
                {canEdit &&
                  openCount > 0 &&
                  reviewState === "current" &&
                  body === document.body && (
                    <button
                      className="button"
                      type="button"
                      disabled={busy}
                      onClick={() => setShowHighlights((current) => !current)}
                    >
                      {showHighlighted ? "Edit text" : "Show highlights"}
                    </button>
                  )}
                {canSubmit && (
                  <button
                    className="button button-success"
                    type="button"
                    disabled={busy}
                    onClick={() => void submit()}
                  >
                    Submit for review
                  </button>
                )}
              </div>
            </>
          )}
        </section>
        <div className="editor-side">
          {!creating && document && (
            <FindingsPanel
              findings={findings}
              busyFindingIds={busyFindingIds}
              readOnly={!canEdit || busy}
              reviewState={reviewState}
              reviewing={reviewing}
              canRunReview={canEdit && !busy}
              onRunReview={() => void reviewDraft()}
              selectedFindingId={selectedId}
              reviewedCustomText={false}
              onSelect={onSelect}
              onResolve={(finding, status, finalText) =>
                resolve(finding, status, finalText)
              }
              evidenceRequests={evidenceRequests}
              evidenceLoading={evidenceLoading}
              evidenceError={evidenceError}
              onRequestEvidence={requestEvidence}
              onRecheck={recheckAccessibility}
              onEditAccessibility={editAccessibility}
            />
          )}
        </div>
      </div>
      {document && !canEdit && role === "creator" && (
        <p className="muted">
          This document is locked while it is in review. Reviewers can inspect
          it from the Review Queue.
        </p>
      )}
      {document && role !== "creator" && (
        <Link className="button" href="/queue">
          Open review queue
        </Link>
      )}
    </section>
  );
}
