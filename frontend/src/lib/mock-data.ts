"use client";

import { useEffect, useSyncExternalStore } from "react";
import auditFixture from "../../mocks/audit.json";
import contentFixture from "../../mocks/content.json";
import {
  SAMPLE_BRAND,
  type BrandAsset,
  type BrandData,
  type BrandFact,
  type GlossaryTerm,
  type Guideline,
} from "./brand-data";
import { DEMO_DRAFT, getDemoFindings, type DemoFinding } from "./mock-findings";
import type { Content, FindingStatus, Role } from "./types";
import {
  canDecideReview,
  canEditContent,
  canManageKnowledge,
  getSubmissionBlockers,
  type DemoReviewSnapshot,
} from "./workflow";

export const MOCK_DATA_NOTICE =
  "Demonstration data only. Documents, checks, findings, sources, and timestamps are fictional and are not verified results.";

export type DemoAuditAction =
  | "created"
  | "draft_edited"
  | "draft_reset"
  | "reviewed"
  | "finding_accepted"
  | "finding_edited"
  | "finding_dismissed"
  | "submitted"
  | "resubmitted"
  | "review_comment_added"
  | "changes_requested"
  | "approved"
  | "ready_to_publish";

export interface DemoAuditChange {
  field: "title" | "body" | "status" | "text";
  previous: string | null;
  next: string | null;
}

export interface DemoAuditEntry {
  id: number;
  content_id: number;
  content_title: string;
  at: string;
  actor: string;
  role: Role;
  action: DemoAuditAction;
  detail: string;
  finding_id?: number;
  finding_title?: string;
  changes?: DemoAuditChange[];
  comment?: string;
}

export interface DemoWorkspace {
  knowledge: BrandData;
  documents: Content[];
  findings: DemoFinding[];
  findingsBody: string | null;
  history: DemoAuditEntry[];
  comments: DemoReviewComment[];
  submissions: DemoSubmissionSnapshot[];
  reviews: DemoReviewSnapshot[];
  persistenceWarning: string | null;
  isHydrated: boolean;
}

export interface DemoReviewComment {
  id: number;
  document_id: number;
  at: string;
  author: string;
  role: Role;
  text: string;
  kind: "comment" | "changes_requested";
}

export interface DemoSubmissionSnapshot {
  id: number;
  document_id: number;
  version: number;
  title: string;
  body: string;
  at: string;
  kind: "submitted" | "resubmitted";
}

export type DemoKnowledgeItem = Guideline | GlossaryTerm | BrandFact | BrandAsset;

const initialDocument: Content = {
  ...contentFixture["POST /api/content"],
  status: "draft",
};
const initialHistory = (auditFixture.response as Omit<
  DemoAuditEntry,
  "content_id" | "content_title"
>[]).map((entry) => ({
  ...entry,
  content_id: initialDocument.id,
  content_title: initialDocument.title,
}));
const initialHistory = auditFixture.response as DemoAuditEntry[];
const initialKnowledge = cloneBrandData(SAMPLE_BRAND);

let workspace: DemoWorkspace = {
  knowledge: initialKnowledge,
  documents: [{ ...initialDocument }],
  findings: [],
  findingsBody: null,
  history: initialHistory.map((entry) => ({ ...entry })),
  comments: [],
  submissions: [],
  reviews: [],
  persistenceWarning: null,
  isHydrated: false,
};

const listeners = new Set<() => void>();
const STORAGE_KEY = "corespace-demo-workspace-v1";
let hydrated = false;
const timestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): DemoWorkspace {
  return workspace;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function persistWorkspace(nextWorkspace: DemoWorkspace): void {
  if (typeof window === "undefined") return;
  try {
    const {
      persistenceWarning: _warning,
      isHydrated: _isHydrated,
      ...persisted
    } = nextWorkspace;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Could not persist demonstration changes in this browser: ${error.message}`
        : "Could not persist demonstration changes in this browser.",
    );
  }
}

function isStoredWorkspace(
  value: unknown,
): value is Omit<DemoWorkspace, "persistenceWarning" | "isHydrated"> & {
  comments?: DemoReviewComment[];
  submissions?: DemoSubmissionSnapshot[];
  reviews?: DemoReviewSnapshot[];
  findingsBody?: string | null;
} {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<DemoWorkspace>;
  return Boolean(
    stored.knowledge &&
      Array.isArray(stored.knowledge.guidelines) &&
      Array.isArray(stored.knowledge.glossary) &&
      Array.isArray(stored.knowledge.facts) &&
      Array.isArray(stored.knowledge.assets) &&
      Array.isArray(stored.documents) &&
      Array.isArray(stored.findings) &&
      Array.isArray(stored.history),
  );
}

function hydrateWorkspace(): void {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      if (!isStoredWorkspace(parsed)) {
        throw new Error("Saved demonstration data has an invalid format.");
      }
      const isLegacyWorkspace = !Array.isArray(parsed.reviews);
      const documents = isLegacyWorkspace
        ? parsed.documents.map((document) =>
            document.id === initialDocument.id && document.status === "in_review"
              ? { ...document, status: "draft" as const }
              : document,
          )
        : parsed.documents;
      workspace = {
        ...parsed,
        documents,
        history: parsed.history.map((entry) => ({
          ...entry,
          content_id: entry.content_id ?? initialDocument.id,
          content_title:
            entry.content_title ??
            documents.find((document) => document.id === initialDocument.id)?.title ??
            initialDocument.title,
        })),
        comments: parsed.comments ?? [],
        submissions: parsed.submissions ?? [],
        reviews: parsed.reviews ?? [],
        findingsBody:
          parsed.findingsBody ??
          (documents.find((document) => document.id === initialDocument.id)?.body ===
          DEMO_DRAFT.body
            ? DEMO_DRAFT.body
            : null),
        persistenceWarning: null,
        isHydrated: true,
      };
      workspace = { ...parsed, persistenceWarning: null, isHydrated: true };
    } else {
      workspace = { ...workspace, isHydrated: true };
    }
  } catch (error) {
    workspace = {
      ...workspace,
      isHydrated: true,
      persistenceWarning:
        error instanceof Error
          ? error.message
          : "Could not read saved demonstration data.",
    };
  }
  notify();
}

function commitWorkspace(nextWorkspace: DemoWorkspace): void {
  persistWorkspace(nextWorkspace);
  workspace = nextWorkspace;
  notify();
}

export function useDemoWorkspace(): DemoWorkspace {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    hydrateWorkspace();
  }, []);
  return snapshot;
}

export function getQueuedDocuments(data: DemoWorkspace): Content[] {
  return data.documents.filter((document) => document.status === "in_review");
}

export function getDocumentFindings(
  data: DemoWorkspace,
  documentId: number,
): DemoFinding[] {
  return data.findings.filter((finding) => finding.content_id === documentId);
}

export function getWorkflowBlockersForDocument(
  data: DemoWorkspace,
  documentId: number,
): string[] {
  const document = data.documents.find((item) => item.id === documentId);
  if (!document) return ["The demonstration document is unavailable."];
  const review = data.reviews.find((item) => item.document_id === documentId);
  return getSubmissionBlockers(
    document,
    review,
    getDocumentFindings(data, documentId),
  );
}

export function formatMockTimestamp(timestamp: string): string {
  return `${timestampFormatter.format(new Date(timestamp))} UTC`;
}

export function getContentAuditEvents(
  data: DemoWorkspace,
  contentId: number,
): DemoAuditEntry[] {
  return data.history
    .filter((entry) => entry.content_id === contentId)
    .sort(
      (left, right) =>
        left.at.localeCompare(right.at) || left.id - right.id,
    );
}

function actorName(user: string): string {
  return user.replace(/\s+\([^)]*\)$/, "");
}

function appendHistory(
  history: DemoAuditEntry[],
  role: Role,
  user: string,
  contentId: number,
  action: DemoAuditAction,
  detail: string,
  at = new Date().toISOString(),
  metadata: Partial<
    Pick<
      DemoAuditEntry,
      "content_title" | "finding_id" | "finding_title" | "changes" | "comment"
    >
  > = {},
): DemoAuditEntry[] {
  const nextId =
    history.reduce((largestId, entry) => Math.max(largestId, entry.id), 0) + 1;
  const content = workspace.documents.find((item) => item.id === contentId);
  return [
    ...history,
    {
      id: nextId,
      content_id: contentId,
      content_title: metadata.content_title ?? content?.title ?? `Document #${contentId}`,
      at,
      actor: actorName(user),
      role,
      action,
      detail,
      ...metadata,
    },
  ];
}

function changedText(previous: string, next: string): DemoAuditChange {
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < next.length &&
    previous[prefix] === next[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    field: "body",
    previous: previous.slice(prefix, previous.length - suffix),
    next: next.slice(prefix, next.length - suffix),
  };
}

  action: string,
  detail: string,
  at = new Date().toISOString(),
): DemoAuditEntry[] {
  const nextId =
    history.reduce((largestId, entry) => Math.max(largestId, entry.id), 0) + 1;
  return [
    ...history,
    { id: nextId, at, actor: actorName(user), role, action, detail },
  ];
}

function cloneBrandData(data: BrandData): BrandData {
  return {
    guidelines: data.guidelines.map((item) => ({ ...item })),
    glossary: data.glossary.map((item) => ({ ...item })),
    facts: data.facts.map((item) => ({ ...item })),
    assets: data.assets.map((item) => ({ ...item })),
  };
}

function nextKnowledgeId(items: DemoKnowledgeItem[]): string {
  const numericIds = items
    .map((item) => Number(item.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return String(Math.max(0, ...numericIds) + 1);
}

const nextKnowledgeIds: Record<keyof BrandData, number> = {
  guidelines: Number(nextKnowledgeId(initialKnowledge.guidelines)),
  glossary: Number(nextKnowledgeId(initialKnowledge.glossary)),
  facts: Number(nextKnowledgeId(initialKnowledge.facts)),
  assets: Number(nextKnowledgeId(initialKnowledge.assets)),
};

function allocateKnowledgeId(collection: keyof BrandData): string {
  const id = nextKnowledgeIds[collection];
  nextKnowledgeIds[collection] += 1;
  return String(id);
}

function commitKnowledge(knowledge: BrandData): void {
  const currentFindingsById = new Map(
    workspace.findings.map((finding) => [finding.id, finding]),
  );
  const currentBody =
    workspace.documents.find((document) => document.id === DEMO_DRAFT.id)?.body ??
    DEMO_DRAFT.body;
  const refreshed = getDemoFindings(currentBody, knowledge);
  const findings = refreshed.map((finding) => {
    const previous = currentFindingsById.get(finding.id);
    return previous
      ? {
          ...finding,
          status: previous.status === "dismissed"
            ? ("dismissed" as const)
            : ("open" as const),
          final_text: previous.final_text,
        }
      : finding;
  });
  const retained = workspace.findings.filter(
    (finding) =>
      finding.status !== "open" &&
      !findings.some((current) => current.id === finding.id),
  );

  commitWorkspace({
    ...workspace,
    knowledge,
    findings: [...findings, ...retained],
    findingsBody: null,
    reviews: [],
  });
  commitWorkspace({ ...workspace, knowledge, findings });
}

export function saveMockKnowledgeItem(
  collection: keyof BrandData,
  editingId: string | null,
  values: Record<string, string>,
  role: Role,
): void {
  if (!canManageKnowledge(role)) {
    throw new Error("Only a brand manager or admin can manage knowledge records.");
  }
  const id = editingId ?? allocateKnowledgeId(collection);

  if (collection === "guidelines") {
    const existing = workspace.knowledge.guidelines.find((item) => item.id === id);
    const item: Guideline = {
      id,
      title: values.title ?? "",
      description: values.description ?? "",
      kind: values.kind || existing?.kind,
    };
    const guidelines = existing
      ? workspace.knowledge.guidelines.map((current) => current.id === id ? item : current)
      : [...workspace.knowledge.guidelines, item];
    commitKnowledge({ ...workspace.knowledge, guidelines });
    return;
  }

  if (collection === "glossary") {
    const existing = workspace.knowledge.glossary.find((item) => item.id === id);
    const item: GlossaryTerm = {
      id,
      term: values.term ?? "",
      definition: values.definition ?? "",
      preferredTerm: values.preferredTerm ?? "",
      status: values.status === "approved" ? "approved" : "prohibited",
      guidelineId: values.guidelineId || undefined,
    };
    const glossary = existing
      ? workspace.knowledge.glossary.map((current) => current.id === id ? item : current)
      : [...workspace.knowledge.glossary, item];
    commitKnowledge({ ...workspace.knowledge, glossary });
    return;
  }

  if (collection === "facts") {
    const existing = workspace.knowledge.facts.find((item) => item.id === id);
    const item: BrandFact = {
      id,
      claim: values.claim ?? "",
      owner: values.owner ?? "",
      reviewDate: values.reviewDate ?? "",
      source: values.source || undefined,
      lastReviewed: values.lastReviewed || undefined,
    };
    const facts = existing
      ? workspace.knowledge.facts.map((current) => current.id === id ? item : current)
      : [...workspace.knowledge.facts, item];
    commitKnowledge({ ...workspace.knowledge, facts });
    return;
  }

  const existing = workspace.knowledge.assets.find((item) => item.id === id);
  const item: BrandAsset = {
    id,
    name: values.name ?? "",
    description: values.description ?? "",
    url: values.url ?? "",
    kind: values.kind || undefined,
    notes: values.notes || undefined,
  };
  const assets = existing
    ? workspace.knowledge.assets.map((current) => current.id === id ? item : current)
    : [...workspace.knowledge.assets, item];
  commitKnowledge({ ...workspace.knowledge, assets });
}

export function removeMockKnowledgeItem(
  collection: keyof BrandData,
  id: string,
  role: Role,
): void {
  if (!canManageKnowledge(role)) {
    throw new Error("Only a brand manager or admin can manage knowledge records.");
  }
  if (collection === "guidelines") {
    commitKnowledge({
      ...workspace.knowledge,
      guidelines: workspace.knowledge.guidelines.filter((item) => item.id !== id),
      glossary: workspace.knowledge.glossary.map((term) =>
        term.guidelineId === id ? { ...term, guidelineId: undefined } : term,
      ),
    });
  } else if (collection === "glossary") {
    commitKnowledge({
      ...workspace.knowledge,
      glossary: workspace.knowledge.glossary.filter((item) => item.id !== id),
    });
  } else if (collection === "facts") {
    commitKnowledge({
      ...workspace.knowledge,
      facts: workspace.knowledge.facts.filter((item) => item.id !== id),
    });
  } else {
    commitKnowledge({
      ...workspace.knowledge,
      assets: workspace.knowledge.assets.filter((item) => item.id !== id),
    });
  }
}

export function resetMockKnowledge(role: Role): void {
  if (!canManageKnowledge(role)) {
    throw new Error("Only a brand manager or admin can load the sample brand.");
  }
  commitKnowledge(cloneBrandData(SAMPLE_BRAND));
}

export function saveDemoDraft(
  documentId: number,
  title: string,
  body: string,
  role: Role,
  user: string,
): Content {
  const document = workspace.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("The demonstration document is unavailable.");
  if (!canEditContent(role, actorName(user), document)) {
    throw new Error("Only the creator can edit their own draft or requested changes.");
  }
  const normalizedTitle = title.trim();
  if (document.title === normalizedTitle && document.body === body) return document;

  const updated: Content = {
    ...document,
    title: normalizedTitle,
    body,
    version: document.version + 1,
    updated_at: new Date().toISOString(),
  };
  const changes: DemoAuditChange[] = [];
  if (document.title !== normalizedTitle) {
    changes.push({
      field: "title",
      previous: document.title,
      next: normalizedTitle,
    });
  }
  if (document.body !== body) changes.push(changedText(document.body, body));
  commitWorkspace({
    ...workspace,
    documents: workspace.documents.map((item) =>
      item.id === documentId ? updated : item,
    ),
    findingsBody: null,
    history: appendHistory(
      workspace.history,
      role,
      user,
      documentId,
      "draft_edited",
      `Edited the draft ${changes.map((change) => change.field).join(" and ")}.`,
      updated.updated_at,
      { content_title: normalizedTitle, changes },
    ),
  });
  return updated;
}

export interface ResolveDemoFindingResult {
  document: Content;
  findings: DemoFinding[];
}

export function resetDemoDocument(
  role: Role,
  user: string,
): ResolveDemoFindingResult {
  const existing = workspace.documents.find(
    (item) => item.id === initialDocument.id,
  );
  if (!existing || !canEditContent(role, actorName(user), existing)) {
    throw new Error("Only the creator can reset their editable demonstration draft.");
  }
  const at = new Date().toISOString();
  const document: Content = {
    ...initialDocument,
    version: existing.version + 1,
    updated_at: at,
  };
  const document = { ...initialDocument };
  const findings = getDemoFindings(document.body, workspace.knowledge);
  const retainedResolved = workspace.findings.filter(
    (finding) =>
      finding.status !== "open" &&
      !findings.some((current) => current.id === finding.id),
  );
  const changes: DemoAuditChange[] = [];
  if (existing.title !== document.title) {
    changes.push({
      field: "title",
      previous: existing.title,
      next: document.title,
    });
  }
  if (existing.body !== document.body) {
    const bodyChange = changedText(existing.body, document.body);
    changes.push(bodyChange);
  }
  if (existing.status !== document.status) {
    changes.push({
      field: "status",
      previous: existing.status,
      next: document.status,
    });
  }
  const nextWorkspace: DemoWorkspace = {
    ...workspace,
    documents: workspace.documents.map((item) =>
      item.id === document.id ? document : item,
    ),
    findings: [...findings, ...retainedResolved],
    findingsBody: null,
    reviews: workspace.reviews.filter((review) => review.document_id !== document.id),
    findings,
    findingsBody: null,
    reviews: workspace.reviews.filter((review) => review.document_id !== document.id),
    comments: workspace.comments.filter((comment) => comment.document_id !== document.id),
    submissions: workspace.submissions.filter(
      (submission) => submission.document_id !== document.id,
    ),
    history: appendHistory(
      workspace.history,
      role,
      user,
      document.id,
      "draft_reset",
      `Reset ${document.title} to the fictional demonstration draft.`,
      at,
      { content_title: document.title, changes },
      "draft_reset",
      `Reset ${document.title} to the fictional demonstration draft.`,
    ),
  };
  commitWorkspace(nextWorkspace);
  return { document, findings };
}

export function transitionDemoDocument(
  documentId: number,
  action: "submit" | "resubmit" | "approve" | "request_changes",
  role: Role,
  user: string,
  comment = "",
): Content {
  if (!["submit", "resubmit", "approve", "request_changes"].includes(action)) {
    throw new Error("Unsupported workflow transition.");
  }
  const document = workspace.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("The demonstration document is unavailable.");
  const normalizedUser = actorName(user);
  let status: Content["status"];
  let history = workspace.history;
  let comments = workspace.comments;
  let submissions = workspace.submissions;
  const at = new Date().toISOString();

  if (action === "submit" || action === "resubmit") {
    if (role !== "creator" || normalizedUser !== document.created_by) {
      throw new Error("Only the creator can submit this draft.");
    }
    const expectedStatus = action === "submit" ? "draft" : "changes_requested";
    if (document.status !== expectedStatus) {
      throw new Error(
        action === "submit"
          ? "Only a draft can be submitted for review."
          : "Only content with requested changes can be resubmitted.",
      );
    }
    const blockers = getWorkflowBlockersForDocument(workspace, documentId);
    if (blockers.length > 0) throw new Error(blockers.join(" "));
    status = "in_review";
    const submissionId =
      submissions.reduce(
        (largestId, submission) => Math.max(largestId, submission.id),
        0,
      ) + 1;
    submissions = [
      ...submissions,
      {
        id: submissionId,
        document_id: document.id,
        version: document.version,
        title: document.title,
        body: document.body,
        at,
        kind: action === "submit" ? "submitted" : "resubmitted",
      },
    ];
    history = appendHistory(
      history,
      role,
      user,
      documentId,
      action === "submit" ? "submitted" : "resubmitted",
      `${action === "submit" ? "Submitted" : "Resubmitted"} ${document.title} for review.`,
      at,
      {
        content_title: document.title,
        changes: [
          {
            field: "status",
            previous: document.status,
            next: "in_review",
          },
        ],
      },
      action === "submit" ? "submitted" : "resubmitted",
      `${action === "submit" ? "Submitted" : "Resubmitted"} ${document.title} for review.`,
      at,
    );
  } else {
    if (!canDecideReview(role)) {
      throw new Error("Only a Reviewer can make a review decision.");
    }
    if (document.status !== "in_review") {
      throw new Error("Only content currently in review can receive a decision.");
    }
    if (action === "approve") {
      const blockers = getWorkflowBlockersForDocument(workspace, documentId);
      if (blockers.length > 0) throw new Error(blockers.join(" "));
      status = "ready_to_publish";
      history = appendHistory(
        history,
        role,
        user,
        documentId,
        "approved",
        comment.trim()
          ? `Approved ${document.title}. Reviewer comment: ${comment.trim()}`
          : `Approved ${document.title}.`,
        at,
        {
          content_title: document.title,
          changes: [
            { field: "status", previous: "in_review", next: "approved" },
          ],
          comment: comment.trim() || undefined,
        },
      );
      if (comment.trim()) {
        history = appendHistory(
          history,
          role,
          user,
          documentId,
          "review_comment_added",
          `Added an approval comment to ${document.title}.`,
          at,
          { content_title: document.title, comment: comment.trim() },
        );
      }
      );
      history = appendHistory(
        history,
        role,
        user,
        documentId,
        "ready_to_publish",
        `${document.title} is ready to publish after reviewer approval and required checks.`,
        at,
        {
          content_title: document.title,
          changes: [
            {
              field: "status",
              previous: "approved",
              next: "ready_to_publish",
            },
          ],
        },
        "ready_to_publish",
        `${document.title} is ready to publish after reviewer approval and required checks.`,
        at,
      );
      if (comment.trim()) {
        comments = appendReviewComment(
          comments,
          documentId,
          role,
          user,
          comment.trim(),
          "comment",
          at,
        );
      }
    } else {
      if (comment.trim().length < 10) {
        throw new Error("Add a meaningful comment of at least 10 characters explaining the requested changes.");
      }
      status = "changes_requested";
      comments = appendReviewComment(
        comments,
        documentId,
        role,
        user,
        comment.trim(),
        "changes_requested",
        at,
      );
      history = appendHistory(
        history,
        role,
        user,
        documentId,
        "changes_requested",
        `Requested changes to ${document.title}: ${comment.trim()}`,
        at,
        {
          content_title: document.title,
          changes: [
            {
              field: "status",
              previous: "in_review",
              next: "changes_requested",
            },
          ],
          comment: comment.trim(),
        },
        "changes_requested",
        `Requested changes to ${document.title}: ${comment.trim()}`,
        at,
      );
    }
  }

  const updated = { ...document, status, updated_at: at };
  commitWorkspace({
    ...workspace,
    documents: workspace.documents.map((item) =>
      item.id === documentId ? updated : item,
    ),
    comments,
    submissions,
    history,
  });
  return updated;
}

function appendReviewComment(
  comments: DemoReviewComment[],
  documentId: number,
  role: Role,
  user: string,
  text: string,
  kind: DemoReviewComment["kind"],
  at = new Date().toISOString(),
): DemoReviewComment[] {
  const id =
    comments.reduce((largestId, comment) => Math.max(largestId, comment.id), 0) +
    1;
  return [
    ...comments,
    {
      id,
      document_id: documentId,
      at,
      author: actorName(user),
      role,
      text,
      kind,
    },
  ];
}

export function addDemoReviewComment(
  documentId: number,
  role: Role,
  user: string,
  text: string,
): void {
  const document = workspace.documents.find((item) => item.id === documentId);
  if (!document) throw new Error("The demonstration document is unavailable.");
  if (!canDecideReview(role)) {
    throw new Error("Only a Reviewer can add a review comment.");
  }
  if (document.status !== "in_review") {
    throw new Error("Comments can only be added while content is in review.");
  }
  if (text.trim().length < 3) {
    throw new Error("Enter a review comment with at least 3 characters.");
  }
  const at = new Date().toISOString();
  const comments = appendReviewComment(
    workspace.comments,
    documentId,
    role,
    user,
    text.trim(),
    "comment",
    at,
  );
  const history = appendHistory(
    workspace.history,
    role,
    user,
    documentId,
    "review_comment_added",
    `Added a review comment to ${document.title}.`,
    at,
    { content_title: document.title, comment: text.trim() },
    "review_comment_added",
    `Added a review comment to ${document.title}.`,
    at,
  );
  commitWorkspace({ ...workspace, comments, history });
}

export function resolveDemoFinding(
  findingId: number,
  status: Exclude<FindingStatus, "open">,
  finalText: string | null,
  role: Role,
  user: string,
): ResolveDemoFindingResult {
  const finding = workspace.findings.find((item) => item.id === findingId);
  if (!finding || finding.status !== "open") {
    throw new Error("This finding is no longer open. Run a new demo review to refresh it.");
  }
  if (!["accepted", "edited", "dismissed"].includes(status)) {
    throw new Error("Unsupported finding action.");
  }

  const document = workspace.documents.find(
    (item) => item.id === finding.content_id,
  );
  if (!document) throw new Error("The document for this finding is unavailable.");
  if (!canEditContent(role, actorName(user), document)) {
    throw new Error("Only the creator can resolve findings on their own editable draft.");
  }

  const replacesText =
    (status === "accepted" || status === "edited") &&
    finalText !== null;
  if (
    (status === "edited" || (status === "accepted" && finalText !== null)) &&
    !finalText?.trim()
  ) {
    throw new Error("Enter a non-empty correction before saving.");
  }

  let updatedBody = document.body;
  let delta = 0;
  if (replacesText) {
    if (finding.range_valid === false) {
      throw new Error("This finding overlaps an earlier correction. Review the text before changing it.");
    }
    const original = document.body.slice(finding.start, finding.end);
    if (
      finding.start < 0 ||
      finding.end > document.body.length ||
      original !== finding.text
    ) {
      throw new Error("The original text no longer matches this finding. Run a new demo review.");
    }
    delta = finalText!.length - (finding.end - finding.start);
    updatedBody =
      document.body.slice(0, finding.start) +
      finalText +
      document.body.slice(finding.end);
  }

  const updatedFindings = workspace.findings.map((item) => {
    if (item.id === finding.id) {
      return {
        ...item,
        status,
        final_text: replacesText ? finalText : null,
        end: replacesText ? finding.start + finalText!.length : finding.end,
      };
    }
    if (!replacesText) return item;

    const transformOffset = (offset: number) => {
      if (offset <= finding.start) return offset;
      if (offset >= finding.end) return offset + delta;
      return finding.start + Math.min(offset - finding.start, finalText!.length);
    };
    const mappedStart = transformOffset(item.start);
    const mappedEnd = transformOffset(item.end);
    if (item.start >= finding.end || item.end <= finding.start) {
      return { ...item, start: mappedStart, end: mappedEnd };
    }
    const rangeMatches =
      updatedBody.slice(mappedStart, mappedEnd) === item.text;
    return {
      ...item,
      start: mappedStart,
      end: mappedEnd,
      range_valid: rangeMatches,
    };
  });

  const updatedDocument: Content = {
    ...document,
    body: updatedBody,
    version: document.version + (replacesText ? 1 : 0),
    updated_at: new Date().toISOString(),
  };
  const actionDetail =
    status === "dismissed"
      ? `Dismissed finding ${finding.id} in ${document.title}.`
      : status === "accepted" && !replacesText
        ? `Accepted finding ${finding.id} in ${document.title} without a replacement; the document text was not changed.`
        : `${status === "accepted" ? "Accepted" : "Edited"} finding ${finding.id} in ${document.title}.`;
  const auditAction: DemoAuditAction =
    status === "accepted"
      ? "finding_accepted"
      : status === "edited"
        ? "finding_edited"
        : "finding_dismissed";
      : `${status === "accepted" ? "Accepted" : "Edited"} finding ${finding.id} in ${document.title}.`;
  const nextWorkspace: DemoWorkspace = {
    ...workspace,
    documents: workspace.documents.map((item) =>
      item.id === document.id ? updatedDocument : item,
    ),
    findings: updatedFindings,
    findingsBody: updatedBody,
    history: appendHistory(
      workspace.history,
      role,
      user,
      document.id,
      auditAction,
      actionDetail,
      updatedDocument.updated_at,
      {
        content_title: document.title,
        finding_id: finding.id,
        finding_title: `${finding.check.replaceAll("_", " ")}: ${finding.text}`,
        comment:
          status === "accepted" && !replacesText
            ? "No replacement was available; the finding was accepted without changing document text."
            : undefined,
        changes: replacesText
          ? [
              {
                field: "text",
                previous: finding.text,
                next: finalText,
              },
            ]
          : undefined,
      },
      status === "dismissed" ? "finding_dismissed" : `finding_${status}`,
      actionDetail,
      updatedDocument.updated_at,
    ),
  };
  commitWorkspace(nextWorkspace);
  return { document: updatedDocument, findings: updatedFindings };
}

export function recordDemoReview(
  body: string,
  role: Role,
  user: string,
): DemoFinding[] {
  const reviewedAt = new Date().toISOString();
  const currentDocument = workspace.documents.find(
    (document) => document.id === DEMO_DRAFT.id,
  );

  if (!currentDocument) {
    throw new Error("The demonstration document is not available.");
  }
  if (!canEditContent(role, actorName(user), currentDocument)) {
    throw new Error("Only the creator can run a review on their own editable draft.");
  }
  if (currentDocument.body !== body) {
    throw new Error("Save your latest draft changes before running the demonstration review.");
  }

  const generatedFindings = getDemoFindings(body, workspace.knowledge);
  const generatedIds = new Set(generatedFindings.map((finding) => finding.id));
  const previousById = new Map(
    workspace.findings.map((finding) => [finding.id, finding]),
  );
  const findings = generatedFindings.map((finding) => {
    const previous = previousById.get(finding.id);
    return previous
      ? {
          ...finding,
          status: previous.status === "dismissed"
            ? ("dismissed" as const)
            : ("open" as const),
          final_text: previous.final_text,
        }
      : finding;
  });
  findings.push(
    ...workspace.findings.filter(
      (finding) =>
        finding.status !== "open" && !generatedIds.has(finding.id),
    ),
  );

  const nextWorkspace: DemoWorkspace = {
    ...workspace,
    documents: workspace.documents.map((document) =>
      document.id === currentDocument.id
        ? { ...document, updated_at: reviewedAt }
        : document,
    ),
    findings,
    findingsBody: body,
    reviews: [
      ...workspace.reviews.filter(
        (review) => review.document_id !== currentDocument.id,
      ),
      {
        document_id: currentDocument.id,
        document_version: currentDocument.version,
        body,
        reviewed_at: reviewedAt,
        scope: "known_demo_checks",
      },
    ],
    history: appendHistory(
      workspace.history,
      role,
      user,
      currentDocument.id,
      "reviewed",
      `Ran the local demonstration checks for known sample phrases in ${currentDocument.title}.`,
      reviewedAt,
      { content_title: currentDocument.title },
      "reviewed",
      `Ran the local demonstration checks for known sample phrases in ${currentDocument.title}.`,
      reviewedAt,
    ),
  };
  commitWorkspace(nextWorkspace);

  return findings;
}
