"use client";

import { useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type {
  Content,
  ContentDraft,
  Finding,
  FindingStatus,
  ReviewResponse,
  SeedResponse,
  CheckType,
  Severity,
} from "@/lib/types";
import FindingsPanel from "./FindingsPanel";

const DEFAULT_TITLE = "Untitled draft";

function validContent(value: unknown): value is Content {
  if (!value || typeof value !== "object") return false;
  const content = value as Partial<Content>;
  return (
    typeof content.id === "number" &&
    typeof content.title === "string" &&
    typeof content.body === "string"
  );
}

const CHECK_TYPES: CheckType[] = [
  "terminology",
  "tone",
  "messaging",
  "unsupported_claim",
  "outdated_info",
];
const SEVERITIES: Severity[] = ["high", "medium", "low"];
const FINDING_STATUSES: FindingStatus[] = [
  "open",
  "accepted",
  "edited",
  "dismissed",
];

function validFinding(value: unknown): value is Finding {
  if (!value || typeof value !== "object") return false;
  const finding = value as Partial<Finding>;
  return (
    typeof finding.id === "number" &&
    Number.isFinite(finding.id) &&
    typeof finding.content_id === "number" &&
    CHECK_TYPES.includes(finding.check as CheckType) &&
    SEVERITIES.includes(finding.severity as Severity) &&
    typeof finding.start === "number" &&
    typeof finding.end === "number" &&
    typeof finding.text === "string" &&
    (finding.explanation === undefined ||
      typeof finding.explanation === "string") &&
    (finding.source === undefined ||
      (typeof finding.source === "object" &&
        finding.source !== null &&
        typeof finding.source.label === "string")) &&
    (finding.suggestion === undefined ||
      finding.suggestion === null ||
      typeof finding.suggestion === "string") &&
    FINDING_STATUSES.includes(finding.status as FindingStatus) &&
    (finding.final_text === undefined ||
      finding.final_text === null ||
      typeof finding.final_text === "string")
  );
}

function validReview(value: unknown): value is ReviewResponse {
  if (!value || typeof value !== "object") return false;
  const review = value as Partial<ReviewResponse>;
  return (
    typeof review.content_version === "number" &&
    Array.isArray(review.findings) &&
    review.findings.every(validFinding)
  );
}

function validSeed(value: unknown): value is SeedResponse {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as Partial<SeedResponse>).content_id === "number"
  );
}

function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) {
      return "Unable to reach the review service. Please check your connection and try again.";
    }
    if (error.status === 404) {
      return "The review service endpoint is not available yet. Your content is still here; try again when the service is ready.";
    }
    return error.message || fallback;
  }
  if (error instanceof Error && error.message === "Invalid API response.") {
    return "The review service returned an unexpected response. Please try again.";
  }
  return fallback;
}

function canApplySuggestion(value: string | null): value is string {
  return Boolean(
    value?.trim() &&
      !/^(remove|verify|use the approved claim|replace|rewrite)\b/i.test(value.trim()),
  );
}

export default function Editor() {
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [body, setBody] = useState("");
  const [contentId, setContentId] = useState<number | null>(null);
  const [contentType, setContentType] = useState("Marketing Copy");
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [seedMessage, setSeedMessage] = useState("");
  const [demoActionNotice, setDemoActionNotice] = useState("");
  const [busyFindingIds, setBusyFindingIds] = useState<number[]>([]);
  const revision = useRef(0);
  const requestNumber = useRef(0);
  const reviewInFlight = useRef(false);

  function resetReviewForEdit() {
    revision.current += 1;
    setFindings(null);
    setReviewError("");
    setDemoActionNotice("");
  }

  function changeTitle(value: string) {
    setTitle(value);
    resetReviewForEdit();
  }

  function changeBody(value: string) {
    setBody(value);
    resetReviewForEdit();
  }

  async function loadSampleDraft() {
    setSeeding(true);
    setSeedMessage("");
    setReviewError("");
    try {
      const seedResult: unknown = await api.seedSample();
      if (!validSeed(seedResult)) throw new Error("Invalid API response.");
      const sample: unknown = await api.getContent(seedResult.content_id);
      if (!validContent(sample)) throw new Error("Invalid API response.");
      setContentId(sample.id);
      setTitle(sample.title);
      setBody(sample.body);
      setFindings(null);
      setDemoActionNotice("");
      revision.current += 1;
    } catch (error) {
      setSeedMessage(
        `${userMessage(error, "The sample draft could not be loaded.")} You can still paste your own content below.`,
      );
    } finally {
      setSeeding(false);
    }
  }

  async function runReview() {
    if (!body.trim() || reviewInFlight.current) return;
    const currentRevision = revision.current;
    const currentRequest = ++requestNumber.current;
    const draft: ContentDraft = {
      title: title.trim() || DEFAULT_TITLE,
      body,
    };

    reviewInFlight.current = true;
    setReviewing(true);
    setReviewError("");
    setFindings(null);
    setDemoActionNotice("");
    try {
      const saved: unknown =
        contentId === null
          ? await api.createContent(draft)
          : await api.updateContent(contentId, draft);
      if (!validContent(saved)) throw new Error("Invalid API response.");
      setContentId(saved.id);

      const result: unknown = await api.reviewContent(saved.id);
      if (!validReview(result)) throw new Error("Invalid API response.");
      if (revision.current === currentRevision && requestNumber.current === currentRequest) {
        setFindings(result.findings);
      }
    } catch (error) {
      if (revision.current === currentRevision && requestNumber.current === currentRequest) {
        setReviewError(
          userMessage(
            error,
            "Unable to review your content. Please check your connection and try again.",
          ),
        );
      }
    } finally {
      if (requestNumber.current === currentRequest) {
        reviewInFlight.current = false;
        setReviewing(false);
      }
    }
  }

  async function resolveFinding(
    finding: Finding,
    status: FindingStatus,
    finalText: string | null,
  ) {
    setBusyFindingIds((ids) => [...ids, finding.id]);
    try {
      let locallyResolved = false;
      try {
        const updated: unknown = await api.patch<unknown>(
          `/api/findings/${finding.id}`,
          { status, final_text: finalText },
        );
        if (
          !updated ||
          typeof updated !== "object" ||
          typeof (updated as Partial<Finding>).status !== "string"
        ) {
          throw new Error("The API returned an invalid finding update.");
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          locallyResolved = true;
        } else {
          throw error;
        }
      }

      setFindings((current) =>
        current?.map((item) =>
          item.id === finding.id
            ? { ...item, status, final_text: finalText }
            : item,
        ) ?? null,
      );
      if (canApplySuggestion(finalText)) {
        setBody((currentBody) => {
          const { start, end } = finding;
          if (
            start >= 0 &&
            end <= currentBody.length &&
            currentBody.slice(start, end) === finding.text
          ) {
            revision.current += 1;
            return `${currentBody.slice(0, start)}${finalText}${currentBody.slice(end)}`;
          }
          return currentBody;
        });
      }
      if (locallyResolved) {
        setDemoActionNotice("This finding update is local to this session and was not saved to the backend.");
      }
    } finally {
      setBusyFindingIds((ids) => ids.filter((id) => id !== finding.id));
    }
  }

  const emptyContent = !body.trim();

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
          disabled={seeding || reviewing}
        >
          {seeding ? "Loading sample..." : "Load sample draft"}
        </button>
      </header>

      {seedMessage && <p className="editor-notice" role="status">{seedMessage}</p>}
      {reviewError && (
        <div className="editor-error" role="alert">
          <p>{reviewError}</p>
          <button
            type="button"
            className="button"
            onClick={() => void runReview()}
            disabled={emptyContent || reviewing}
          >
            Retry review
          </button>
        </div>
      )}
      {demoActionNotice && <p className="editor-notice" role="status">{demoActionNotice}</p>}

      <div className="editor-layout">
        <section className="editor-card compose-panel" aria-labelledby="compose-heading">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Draft</p>
              <h2 id="compose-heading">Your content</h2>
            </div>
            {contentId !== null && <span className="draft-id">Draft #{contentId}</span>}
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
              />
            </label>
            <label className="form-field" htmlFor="content-type">
              Content type
              <select
                id="content-type"
                value={contentType}
                onChange={(event) => setContentType(event.target.value)}
              >
                <option>Marketing Copy</option>
              </select>
            </label>
            <label className="form-field" htmlFor="draft-body">
              Content
              <textarea
                id="draft-body"
                className="draft-textarea"
                value={body}
                onChange={(event) => changeBody(event.target.value)}
                placeholder="Paste or write your content here..."
                rows={14}
              />
            </label>
          </div>

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
                  setContentId(null);
                }}
                disabled={!body && contentId === null}
              >
                Clear
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => void runReview()}
                disabled={emptyContent || reviewing}
              >
                {reviewing && <span className="loading-spinner" aria-hidden="true" />}
                {reviewing ? "Reviewing your content..." : "Run Review"}
              </button>
            </div>
          </div>
        </section>

        <FindingsPanel
          findings={findings}
          busyFindingIds={busyFindingIds}
          onResolve={resolveFinding}
        />
      </div>
    </section>
  );
}
