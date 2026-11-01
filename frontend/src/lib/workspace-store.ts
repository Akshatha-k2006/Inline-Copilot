"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ApiError, api, getRole } from "./api";
import { EMPTY_BRAND_DATA, type BrandData } from "./brand-data";
import { toDemoFinding, type DemoFinding } from "./findings";
import { loadBrandData } from "./knowledge";
import { useRole } from "./role";
import type {
  BackendFinding,
  Content,
  ContentAuditEvent,
  FindingStatus,
  ReviewResponse,
  Role,
} from "./types";
import { canManageKnowledge } from "./workflow";

export const BACKEND_DATA_NOTICE =
  "Live demonstration data is loaded from and saved to the configured backend service.";

export interface WorkspaceComment {
  id: number;
  document_id: number;
  at: string;
  author: string;
  text: string;
  kind: "comment";
}

export interface WorkspaceAuditEntry {
  id: number;
  content_id: number | null;
  content_title: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  status_change?: {
    previous: string | null;
    next: string | null;
    actor_role: string | null;
  };
}

export interface WorkspaceState {
  knowledge: BrandData;
  documents: Content[];
  findings: DemoFinding[];
  comments: WorkspaceComment[];
  history: WorkspaceAuditEntry[];
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
}

const EMPTY_STATE: WorkspaceState = {
  knowledge: EMPTY_BRAND_DATA,
  documents: [],
  findings: [],
  comments: [],
  history: [],
  isLoaded: false,
  isLoading: false,
  error: null,
};

let workspace: WorkspaceState = EMPTY_STATE;
let loadedRole: Role | null = null;
let loadChain: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): WorkspaceState {
  return workspace;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "The backend data could not be loaded.";
}

/**
 * Cold-start handling. Free hosting plans (for example the Render free tier)
 * sleep the backend after inactivity; the first load after that has to wait
 * for the service to boot, so failing request is retried before giving up.
 */
const COLD_START_RETRY_DELAYS_MS = [20000, 40000];

function isNetworkError(cause: unknown): boolean {
  return (
    cause instanceof ApiError &&
    cause.status === 0 &&
    cause.code === "network_error"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface LoadOptions {
  force?: boolean;
  silent?: boolean;
}

function auditStatusChange(
  event: ContentAuditEvent,
): WorkspaceAuditEntry["status_change"] {
  if (event.action !== "content_status_changed") return undefined;
  const details = event.details ?? {};
  return {
    previous:
      typeof details.previous_status === "string"
        ? details.previous_status
        : null,
    next:
      typeof details.new_status === "string" ? details.new_status : null,
    actor_role:
      typeof details.actor_role === "string" ? details.actor_role : null,
  };
}

function describeAudit(event: ContentAuditEvent, title: string): string {
  const details = event.details ?? {};
  const previous = details.previous_status;
  const next = details.new_status;
  const changes = details.changes;

  switch (event.action) {
    case "content_created":
      return `Created ${title}.`;
    case "content_updated":
      return details.previous_version !== undefined
        ? `Edited ${title} (version ${String(details.previous_version)} to ${String(details.new_version)}).`
        : `Edited ${title}.`;
    case "content_status_changed":
      return previous !== undefined || next !== undefined
        ? `Changed ${title} from ${String(previous ?? "unknown").replaceAll("_", " ")} to ${String(next ?? "unknown").replaceAll("_", " ")}.`
        : `Updated the status of ${title}.`;
    case "finding_accepted":
    case "finding_edited":
    case "finding_dismissed": {
      const label = event.action.replaceAll("_", " ");
      if (changes && typeof changes === "object") {
        const change = changes as Record<string, unknown>;
        return `${label}: replaced "${String(change.previous ?? "")}" with "${String(change.next ?? "")}" in ${title}.`;
      }
      return `${label} in ${title}.`;
    }
    case "comment_added":
      return `Added a review comment to ${title}.`;
    case "sample_brand_loaded":
      return "Loaded the sample brand into the backend.";
    case "content_deleted":
      return "Deleted content.";
    default:
      return `${event.action.replaceAll("_", " ")} in ${title}.`;
  }
}

function currentTitle(
  contentId: number | null,
  documents: Content[],
): string {
  if (contentId === null) return "Removed content";
  return (
    documents.find((document) => document.id === contentId)?.title ??
    `Document #${contentId}`
  );
}

async function fetchFindings(
  documents: Content[],
  knowledge: BrandData,
): Promise<DemoFinding[]> {
  const responses = await Promise.all(
    documents.map(async (document) => {
      try {
        const response = await api.getContentFindings(document.id);
        return { document, response };
      } catch {
        return { document, response: null };
      }
    }),
  );

  return responses.flatMap(({ document, response }) => {
    if (!response) return [];
    return response.findings
      .filter(
        (finding: BackendFinding) =>
          (finding.content_version ?? response.content_version) ===
          document.version,
      )
      .map((finding) =>
        toDemoFinding(finding, document.id, knowledge, response.content_version),
      )
      .sort((left, right) => left.start - right.start || left.id - right.id);
  });
}

async function fetchComments(documents: Content[]): Promise<WorkspaceComment[]> {
  const responses = await Promise.all(
    documents.map(async (document) => {
      try {
        return { document, response: await api.getReviewComments(document.id) };
      } catch {
        return { document, response: null };
      }
    }),
  );

  return responses.flatMap(({ document, response }) =>
    (response?.comments ?? []).map((comment) => ({
      id: comment.id,
      document_id: document.id,
      at: comment.created_at,
      author: comment.author,
      text: comment.body,
      kind: "comment" as const,
    })),
  );
}

async function loadFromBackend(
  role: Role,
  options: LoadOptions,
): Promise<void> {
  if (!options.silent) {
    workspace = { ...workspace, isLoading: true, error: null };
    notify();
  }

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const [knowledge, documents, audit] = await Promise.all([
          loadBrandData(),
          api.listContent(),
          api.getAudit(),
        ]);
        const [findings, comments] = await Promise.all([
          fetchFindings(documents, knowledge),
          fetchComments(documents),
        ]);

        workspace = {
          knowledge,
          documents,
          findings,
          comments,
          history: audit.map((event) => ({
            id: event.id,
            content_id: event.content_id,
            content_title: currentTitle(event.content_id, documents),
            at: event.created_at,
            actor: event.actor,
            action: event.action,
            detail: describeAudit(
              event,
              currentTitle(event.content_id, documents),
            ),
            status_change: auditStatusChange(event),
          })),
          isLoaded: true,
          isLoading: false,
          error: null,
        };
        loadedRole = role;
        break;
      } catch (cause) {
        // Only a sleeping backend that has to wake up is retried; other
        // failures (HTTP errors, aborts) surface immediately.
        if (
          options.silent ||
          attempt >= COLD_START_RETRY_DELAYS_MS.length ||
          !isNetworkError(cause)
        ) {
          throw cause;
        }
        workspace = {
          ...workspace,
          isLoading: true,
          error:
            "The backend is starting up after inactivity (this can take about a minute). Retrying…",
        };
        notify();
        await sleep(COLD_START_RETRY_DELAYS_MS[attempt]);
      }
    }
  } catch (cause) {
    workspace = {
      ...workspace,
      isLoading: false,
      error: errorMessage(cause),
    };
  } finally {
    notify();
  }
}

export function loadWorkspace(options: LoadOptions = {}): Promise<void> {
  const task = async () => {
    const role = getRole();
    if (!options.force && workspace.isLoaded && loadedRole === role) return;
    await loadFromBackend(role, options);
  };
  loadChain = loadChain.then(task, task);
  return loadChain;
}

export function refreshWorkspace(): Promise<void> {
  return loadWorkspace({ force: true, silent: true });
}

export function useWorkspace(): WorkspaceState {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const { role, isRoleLoaded } = useRole();

  useEffect(() => {
    if (!isRoleLoaded) return;
    void loadWorkspace();
  }, [isRoleLoaded, role]);

  return snapshot;
}

export function getQueuedDocuments(data: WorkspaceState): Content[] {
  return data.documents.filter((document) => document.status === "in_review");
}

export function getDocumentFindings(
  data: WorkspaceState,
  documentId: number,
): DemoFinding[] {
  return data.findings.filter((finding) => finding.content_id === documentId);
}

function requireDocument(documentId: number): Content {
  const document = workspace.documents.find((item) => item.id === documentId);
  if (!document) {
    throw new Error(
      "This document is no longer available. Refresh the workspace and try again.",
    );
  }
  return document;
}

export async function createDocument(
  title: string,
  body: string,
  role: Role,
): Promise<Content> {
  if (role !== "creator") {
    throw new Error("Only the Creator can create a document.");
  }
  const normalizedTitle = title.trim();
  const normalizedBody = body.trim();
  if (!normalizedTitle) {
    throw new Error("Enter a document title before creating a draft.");
  }

  const created = await api.createContent({
    title: normalizedTitle,
    content_type: "other",
    body: normalizedBody,
  });
  await refreshWorkspace();
  return created;
}

export async function saveDraft(
  documentId: number,
  title: string,
  body: string,
  role: Role,
): Promise<Content> {
  const document = requireDocument(documentId);
  if (role !== "creator") {
    throw new Error("Only the Creator can edit a draft.");
  }
  if (document.status !== "draft") {
    throw new Error("Only a draft can be edited.");
  }

  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("Add a document title before saving.");
  if (!body.trim()) throw new Error("Add content before saving.");

  if (document.title === normalizedTitle && document.body === body) {
    return document;
  }

  const updated = await api.updateContent(document.id, {
    title: normalizedTitle,
    content_type: document.content_type || "other",
    body,
    version: document.version,
  });
  await refreshWorkspace();
  return updated;
}

export async function deleteDocument(
  documentId: number,
  role: Role,
): Promise<void> {
  const document = requireDocument(documentId);
  if (role !== "creator") {
    throw new Error("Only the Creator can delete a draft.");
  }
  if (document.status !== "draft") {
    throw new Error("Only a draft can be deleted.");
  }
  await api.deleteContent(document.id);
  await refreshWorkspace();
}

export async function runContentReview(
  documentId: number,
  role: Role,
): Promise<ReviewResponse> {
  const document = requireDocument(documentId);
  if (role !== "creator") {
    throw new Error("Only the Creator can review their own draft.");
  }
  if (document.status !== "draft") {
    throw new Error("Only a draft can be reviewed.");
  }
  const response = await api.reviewContent(document.id);
  await refreshWorkspace();
  return response;
}

export async function resolveFinding(
  findingId: number,
  status: Exclude<FindingStatus, "open">,
  replacement: string | null,
  role: Role,
): Promise<void> {
  if (role !== "creator") {
    throw new Error("Only the Creator can resolve findings.");
  }

  if (status === "dismissed") {
    await api.updateFinding(findingId, { action: "dismiss" });
  } else if (status === "accepted") {
    await api.updateFinding(findingId, { action: "accept" });
  } else {
    const text = replacement?.trim();
    if (!text) throw new Error("Enter a non-empty correction before saving.");
    await api.updateFinding(findingId, { action: "edit", replacement: text });
  }

  await refreshWorkspace();
}

export async function submitDocument(
  documentId: number,
  role: Role,
): Promise<void> {
  if (role !== "creator") {
    throw new Error("Only the Creator can submit a draft for review.");
  }
  const document = requireDocument(documentId);
  try {
    if (document.status !== "self_checked") {
      await api.selfCheckContent(documentId);
    }
    await api.submitContent(documentId);
  } finally {
    // Reflect a successful self-check even if submission failed so the UI can
    // retry the remaining transition.
    await refreshWorkspace();
  }
}

export async function decideContentReview(
  documentId: number,
  decision: "approve" | "request_changes",
  comment: string,
  role: Role,
): Promise<void> {
  if (role !== "reviewer") {
    throw new Error("Only a Reviewer can make a review decision.");
  }
  await api.decideContent(documentId, {
    decision,
    comment: comment.trim() || undefined,
  });
  await refreshWorkspace();
}

export async function addReviewComment(
  documentId: number,
  text: string,
  role: Role,
): Promise<void> {
  if (role !== "reviewer") {
    throw new Error("Only a Reviewer can add a review comment.");
  }
  await api.addReviewComment(documentId, { body: text.trim() });
  await refreshWorkspace();
}

export type KnowledgeTab = keyof BrandData;

export async function saveKnowledgeItem(
  collection: KnowledgeTab,
  editingId: string | null,
  values: Record<string, string>,
  role: Role,
): Promise<void> {
  if (!canManageKnowledge(role)) {
    throw new Error(
      "Only a Brand Manager or Admin can manage knowledge records.",
    );
  }

  const id = editingId ? Number(editingId) : null;

  if (collection === "guidelines") {
    const body = {
      title: (values.title ?? "").trim(),
      description: values.description ?? "",
      category: values.category || "general",
    };
    if (!body.title) throw new Error("Enter a guideline title.");
    if (id) await api.updateGuideline(id, body);
    else await api.createGuideline(body);
  } else if (collection === "glossary") {
    const body = {
      term: (values.term ?? "").trim(),
      definition: values.definition ?? "",
      preferredTerm: values.preferredTerm?.trim() || null,
      status:
        values.status === "approved"
          ? ("approved" as const)
          : ("prohibited" as const),
      guidelineId: values.guidelineId ? Number(values.guidelineId) : null,
    };
    if (!body.term) throw new Error("Enter a term.");
    if (id) await api.updateGlossaryTerm(id, body);
    else await api.createGlossaryTerm(body);
  } else if (collection === "facts") {
    if (!values.reviewDate) throw new Error("Enter a review date.");
    const body = {
      claim: (values.claim ?? "").trim(),
      owner: (values.owner ?? "").trim(),
      reviewDate: values.reviewDate,
      source: values.source ?? "",
      lastReviewed: values.lastReviewed || null,
    };
    if (!body.claim) throw new Error("Enter a fact statement.");
    if (!body.owner) throw new Error("Enter a fact owner.");
    if (id) await api.updateFact(id, body);
    else await api.createFact(body);
  } else {
    const body = {
      name: (values.name ?? "").trim(),
      description: values.description ?? values.notes ?? "",
      url: values.url || null,
      assetType: values.assetType || values.kind || "other",
    };
    if (!body.name) throw new Error("Enter an asset name.");
    if (id) await api.updateAsset(id, body);
    else await api.createAsset(body);
  }

  await refreshWorkspace();
}

export async function removeKnowledgeItem(
  collection: KnowledgeTab,
  id: string,
  role: Role,
): Promise<void> {
  if (!canManageKnowledge(role)) {
    throw new Error(
      "Only a Brand Manager or Admin can manage knowledge records.",
    );
  }
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error("This record cannot be removed.");
  }

  if (collection === "guidelines") await api.deleteGuideline(numericId);
  else if (collection === "glossary") await api.deleteGlossaryTerm(numericId);
  else if (collection === "facts") await api.deleteFact(numericId);
  else await api.deleteAsset(numericId);

  await refreshWorkspace();
}

export async function seedSampleBrand(role: Role): Promise<void> {
  if (!canManageKnowledge(role)) {
    throw new Error("Only a Brand Manager or Admin can load the sample brand.");
  }
  await api.seedSample();
  await refreshWorkspace();
}
