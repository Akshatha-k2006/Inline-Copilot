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
  recordDemoReview,
  resetDemoDocument,
  resolveDemoFinding,
  useDemoWorkspace,
} from "@/lib/mock-data";
import type { FindingStatus } from "@/lib/types";
import FindingsPanel from "./FindingsPanel";
import HighlightedDraft from "./HighlightedDraft";

const DEFAULT_TITLE = "Untitled draft";

export default function Editor() {
  const workspace = useDemoWorkspace();
  const [title, setTitle] = useState(DEMO_DRAFT.title);
  const [body, setBody] = useState(DEMO_DRAFT.body);
  const [contentType, setContentType] = useState("Marketing Copy");
  const [findings, setFindings] = useState<DemoFinding[] | null>(
    workspace.findings,
  );
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

  useEffect(() => {
    if (!currentDocument) return;
    setTitle(currentDocument.title);
    setBody(currentDocument.body);
    setFindings(workspace.findings);
    setSelectedFindingId(null);
  }, [currentDocument?.title, currentDocument?.body, workspace.findings]);

  function resetReviewForEdit() {
    reviewRevision.current += 1;
    setFindings(null);
    setSelectedFindingId(null);
    setReviewedCustomText(false);
  }

  function changeTitle(value: string) {
    setTitle(value);
    resetReviewForEdit();
  }

  function changeBody(value: string) {
    setBody(value);
    resetReviewForEdit();
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
    if (!workspace.isHydrated || !body.trim() || reviewInFlight.current) return;
    const currentRevision = reviewRevision.current;
    const submittedBody = body;

    reviewInFlight.current = true;
    setReviewing(true);
    setFindings(null);
    setSelectedFindingId(null);

    await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
    if (reviewRevision.current === currentRevision) {
      try {
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
            Check your content against your brand guidelines and approved facts.
          </p>
        </div>
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
        {DEMO_FINDINGS_NOTICE} Live backend review is not connected.
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
                disabled={!workspace.isHydrated}
              />
            </label>
            <label className="form-field" htmlFor="content-type">
              Content type
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
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
                {reviewing && <span className="loading-spinner" aria-hidden="true" />}
                {reviewing ? "Reviewing demo content..." : "Run Demo Review"}
              </button>
            </div>
          </div>
        </section>

        <FindingsPanel
          findings={findings}
          busyFindingIds={
            workspace.isHydrated
              ? busyFindingIds
              : findings?.map((finding) => finding.id) ?? []
          }
          selectedFindingId={selectedFindingId}
          reviewedCustomText={reviewedCustomText}
          onSelect={(finding) => selectFinding(finding, true)}
          onResolve={resolveFinding}
        />
      </div>
    </section>
  );
}
