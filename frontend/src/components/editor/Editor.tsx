"use client";

import { useEffect, useRef, useState } from "react";
import type { DemoFinding } from "@/lib/mock-findings";
import {
  CUSTOM_CONTENT_NOTICE,
  DEMO_DRAFT,
  DEMO_FINDINGS_NOTICE,
  isReplacementSuggestion,
} from "@/lib/mock-findings";
import {
  getDocumentFindings,
  getWorkflowBlockersForDocument,
  recordDemoReview,
  resetDemoDocument,
  resolveDemoFinding,
  saveDemoDraft,
  transitionDemoDocument,
  useDemoWorkspace,
} from "@/lib/mock-data";
import { useRole } from "@/lib/role";
import type { FindingStatus } from "@/lib/types";
import {
  canEditContent,
  contentStatusLabel,
  reviewIsCurrent,
} from "@/lib/workflow";
import FindingsPanel from "./FindingsPanel";
import HighlightedDraft from "./HighlightedDraft";

const DEFAULT_TITLE = "Untitled draft";

export default function Editor() {
  const workspace = useDemoWorkspace();
  const { role, user } = useRole();
  const [title, setTitle] = useState(DEMO_DRAFT.title);
  const [body, setBody] = useState(DEMO_DRAFT.body);
  const [contentType, setContentType] = useState("Marketing Copy");
  const [reviewing, setReviewing] = useState(false);
  const [operationError, setOperationError] = useState("");
  const [reviewedCustomText, setReviewedCustomText] = useState(false);
  const [selectedFindingId, setSelectedFindingId] = useState<number | null>(null);
  const [busyFindingIds, setBusyFindingIds] = useState<number[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const reviewInFlight = useRef(false);
  const reviewRevision = useRef(0);
  const currentDocument = workspace.documents.find(
    (item) => item.id === DEMO_DRAFT.id,
  );
  const mayEdit = Boolean(
    currentDocument && canEditContent(role, user, currentDocument),
  );
  const review = workspace.reviews.find(
    (item) => item.document_id === currentDocument?.id,
  );
  const reviewCurrent = Boolean(
    currentDocument && reviewIsCurrent(currentDocument, review),
  );
  const findings =
    currentDocument &&
    currentDocument.body === body &&
    workspace.findingsBody === body
      ? getDocumentFindings(workspace, currentDocument.id)
      : null;
  const comments = currentDocument
    ? workspace.comments.filter(
        (comment) => comment.document_id === currentDocument.id,
      )
    : [];
  const workflowBlockers = currentDocument
    ? getWorkflowBlockersForDocument(workspace, currentDocument.id)
    : ["The demonstration document is unavailable."];
  const canSubmit =
    mayEdit &&
    currentDocument !== undefined &&
    (currentDocument.status === "draft" ||
      currentDocument.status === "changes_requested");

  useEffect(() => {
    if (!currentDocument) return;
    setTitle(currentDocument.title);
    setBody(currentDocument.body);
    setSelectedFindingId(null);
  }, [currentDocument?.title, currentDocument?.body]);
    setFindings(workspace.findings);
    setSelectedFindingId(null);
  }, [currentDocument?.title, currentDocument?.body, workspace.findings]);

  function resetReviewForEdit() {
    reviewRevision.current += 1;
    setSelectedFindingId(null);
    setReviewedCustomText(false);
  }

  function changeTitle(value: string) {
    setTitle(value);
    resetReviewForEdit();
    persistDraftChange(value, body);
  }

  function changeBody(value: string) {
    setBody(value);
    resetReviewForEdit();
    persistDraftChange(title, value);
  }

  function persistDraftChange(nextTitle: string, nextBody: string) {
    if (!currentDocument || !mayEdit || !workspace.isHydrated) return;
    try {
      saveDemoDraft(currentDocument.id, nextTitle, nextBody, role, user);
      setOperationError("");
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "Could not save this draft.",
      );
    }
  }

  function selectFinding(finding: DemoFinding, scrollToText = false) {
    setSelectedFindingId(finding.id);
    if (!scrollToText) return;

    const highlight = document.getElementById(`draft-highlight-${finding.id}`);
    highlight?.scrollIntoView({ block: "center", behavior: "smooth" });
    bodyRef.current?.focus({ preventScroll: true });
    bodyRef.current?.setSelectionRange(finding.start, finding.end);
  }

  function selectFromHighlightedDraft(finding: DemoFinding) {
    selectFinding(finding);
    document
      .getElementById(`finding-card-${finding.id}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function loadSampleDraft() {
    if (!workspace.isHydrated || !mayEdit || !currentDocument) return;
    setOperationError("");
    try {
      const sample = resetDemoDocument(role, user);
      setTitle(sample.document.title);
      setBody(sample.document.body);
    if (!workspace.isHydrated) return;
    setOperationError("");
    try {
      const sample = resetDemoDocument();
      setTitle(sample.document.title);
      setBody(sample.document.body);
      setFindings(sample.findings);
      setReviewedCustomText(false);
      setSelectedFindingId(null);
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "Could not reset the demonstration draft.",
      );
    }
  }

  async function runReview() {
    if (!mayEdit || !currentDocument || !body.trim() || reviewInFlight.current) return;
    const currentRevision = reviewRevision.current;
    const submittedBody = body;

    reviewInFlight.current = true;
    setReviewing(true);
    setSelectedFindingId(null);

    await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    if (reviewRevision.current === currentRevision) {
      try {
        saveDemoDraft(currentDocument.id, title, submittedBody, role, user);
        const demoFindings = recordDemoReview(submittedBody, role, user);
        const demoFindings = recordDemoReview(submittedBody);
        setFindings(demoFindings);
        setReviewedCustomText(demoFindings.length === 0);
        setOperationError("");
      } catch (error) {
        setOperationError(
          error instanceof Error ? error.message : "Could not save this demo review.",
        );
      }
    }
    reviewInFlight.current = false;
    setReviewing(false);
  }

  async function resolveFinding(
    finding: DemoFinding,
    status: Exclude<FindingStatus, "open">,
    finalText: string | null,
  ) {
    if (!workspace.isHydrated) return;
    setBusyFindingIds((ids) => [...ids, finding.id]);
    try {
      const result = resolveDemoFinding(
        finding.id,
        status,
        finalText,
        role,
        user,
      );
      setBody(result.document.body);
      setSelectedFindingId(null);
    } finally {
      setBusyFindingIds((ids) => ids.filter((id) => id !== finding.id));
    }
  }

  function submitForReview() {
    if (!canSubmit || !currentDocument) return;
    setOperationError("");
    try {
      saveDemoDraft(currentDocument.id, title, body, role, user);
      const action =
        currentDocument.status === "changes_requested" ? "resubmit" : "submit";
      transitionDemoDocument(currentDocument.id, action, role, user);
    } catch (error) {
      setOperationError(
        error instanceof Error ? error.message : "Could not submit this draft.",
      );
      const result = resolveDemoFinding(finding.id, status, finalText);
      setBody(result.document.body);
      setFindings(result.findings);
      setSelectedFindingId(null);
    } finally {
      setBusyFindingIds((ids) => ids.filter((id) => id !== finding.id));
    }
  }

  const emptyContent = !body.trim();
  const isDemonstrationDraft = body === DEMO_DRAFT.body;

  return (
    <section className="editor-page">
      <header className="editor-page-heading">
        <div>
          <p className="eyebrow">CoRESpace / Workspace</p>
          <h1>Write &amp; Review</h1>
          <p className="lead">
            Review the sample draft with the active demo role. Mock checks are limited to fixed known phrases.
          </p>
        </div>
        {mayEdit && (
          <button
            type="button"
            className="button"
            onClick={() => void loadSampleDraft()}
            disabled={reviewing || !workspace.isHydrated}
          >
            Load demonstration draft
          </button>
        )}
        <button
          type="button"
          className="button"
          onClick={() => void loadSampleDraft()}
          disabled={reviewing || !workspace.isHydrated}
        >
          Load demonstration draft
        </button>
      </header>

      <p className="editor-demo-banner" role="note">
        {DEMO_FINDINGS_NOTICE} This role switcher is a prototype, not authentication. No backend review or publishing is connected.
      </p>
      {operationError && <p className="form-error" role="alert">{operationError}</p>}
      {!workspace.isHydrated && (
        <p className="editor-notice" role="status">Loading saved demonstration changes...</p>
      )}
      {workspace.persistenceWarning && (
        <p className="editor-notice" role="alert">
          Saved mock changes could not be restored: {workspace.persistenceWarning}
        </p>
      )}
      <p className="editor-notice" role="note">
        Finding actions are saved only in this browser&apos;s local demonstration data, not to a server.
      </p>
      {operationError && <p className="form-error" role="alert">{operationError}</p>}
      {!workspace.isHydrated && (
        <p className="editor-notice" role="status">Loading saved demonstration changes...</p>
      )}
      {workspace.persistenceWarning && (
        <p className="editor-notice" role="alert">
          Saved mock changes could not be restored: {workspace.persistenceWarning}
        </p>
      )}
      <p className="editor-notice" role="note">
        Finding actions are saved only in this browser&apos;s local demonstration data, not to a server.
      </p>
      {reviewedCustomText && (
        <p className="editor-notice" role="status">{CUSTOM_CONTENT_NOTICE}</p>
      )}
      {currentDocument && (
        <div className="workflow-status-line">
          <span className={`content-status status-${currentDocument.status}`}>
            {contentStatusLabel(currentDocument.status)}
          </span>
          <span>Version {currentDocument.version}</span>
          {review && (
            <span>
              {reviewCurrent
                ? "Current mock review"
                : "Review is stale; run the known demo checks again"}
            </span>
          )}
        </div>
      )}
      {!mayEdit && (
        <p className="editor-notice" role="note">
          This document is read-only for {role.replaceAll("_", " ")}. Only its creator can edit or submit a draft.
        </p>
      )}

      <div className="editor-layout">
        <section className="editor-card compose-panel" aria-labelledby="compose-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Draft</p>
              <h2 id="compose-heading">Your content</h2>
            </div>
            {isDemonstrationDraft && <span className="draft-id">Fictional sample</span>}
          </div>

          <div className="editor-fields">
            <label className="form-field" htmlFor="draft-title">
              Title
              <input
                id="draft-title"
                type="text"
                value={title}
                onChange={(event) => changeTitle(event.target.value)}
                placeholder="Give your draft a title"
                readOnly={!mayEdit}
                disabled={!workspace.isHydrated}
              />
            </label>
            <label className="form-field" htmlFor="content-type">
              Content type
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
                disabled={!mayEdit || !workspace.isHydrated}
                disabled={!workspace.isHydrated}
              >
                <option>Marketing Copy</option>
              </select>
            </label>
            <label className="form-field" htmlFor="draft-body">
              Content
              <textarea
                id="draft-body"
                ref={bodyRef}
                className="draft-textarea"
                value={body}
                onChange={(event) => changeBody(event.target.value)}
                placeholder="Paste or write your content here..."
                rows={14}
                readOnly={!mayEdit}
                disabled={!workspace.isHydrated}
              />
            </label>
          </div>

          {findings && findings.length > 0 && (
            <HighlightedDraft
              body={body}
              findings={findings}
              selectedFindingId={selectedFindingId}
              onSelect={selectFromHighlightedDraft}
            />
          )}

          <div className="editor-controls">
            <span className="character-count" aria-live="polite">
              {body.length.toLocaleString()} characters
            </span>
            {mayEdit && (
              <div className="editor-buttons">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    changeBody("");
                    changeTitle(DEFAULT_TITLE);
                  }}
                  disabled={!body || !workspace.isHydrated}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void runReview()}
                  disabled={emptyContent || reviewing || !workspace.isHydrated}
                >
                  {reviewing && <span className="loading-spinner" aria-hidden="true" />}
                  {reviewing ? "Reviewing demo content..." : "Run Demo Review"}
                </button>
              </div>
            )}
          </div>
          {canSubmit && (
            <section className="workflow-action-card" aria-labelledby="submit-heading">
              <h3 id="submit-heading">
                {currentDocument?.status === "changes_requested"
                  ? "Resubmit revised content"
                  : "Submit for review"}
              </h3>
              <p>
                A current demonstration review and no unresolved high-severity findings are required.
                Dismissing a high-severity finding does not count as correcting it.
              </p>
              {workflowBlockers.length > 0 && (
                <ul className="workflow-blockers">
                  {workflowBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                </ul>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={submitForReview}
                disabled={!workspace.isHydrated || workflowBlockers.length > 0}
            <div className="editor-buttons">
              <button
                type="button"
                className="button"
                onClick={() => {
                  changeBody("");
                  setTitle(DEFAULT_TITLE);
                }}
                disabled={!body || !workspace.isHydrated}
              >
                Clear
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void runReview()}
                disabled={emptyContent || reviewing || !workspace.isHydrated}
              >
                {currentDocument?.status === "changes_requested"
                  ? "Resubmit for review"
                  : "Submit for review"}
              </button>
            </section>
          )}
        </section>

        <FindingsPanel
          findings={findings}
          busyFindingIds={
            workspace.isHydrated
              ? busyFindingIds
              : findings?.map((finding) => finding.id) ?? []
          }
          readOnly={!mayEdit}
          selectedFindingId={selectedFindingId}
          reviewedCustomText={reviewedCustomText}
          onSelect={(finding) => selectFinding(finding, true)}
          onResolve={mayEdit ? resolveFinding : undefined}
        />
      </div>
      {comments.length > 0 && (
        <section className="card workflow-comments" aria-labelledby="review-comments-heading">
          <h2 id="review-comments-heading">Review comments and requested changes</h2>
          <ul>
            {comments.map((comment) => (
              <li key={comment.id}>
                <p>{comment.text}</p>
                <small>{comment.author} · {comment.role.replaceAll("_", " ")} · {comment.kind.replaceAll("_", " ")}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
