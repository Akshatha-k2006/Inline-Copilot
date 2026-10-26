"use client";

import { useEffect, useSyncExternalStore } from "react";
import auditFixture from "../../mocks/audit.json";
import contentFixture from "../../mocks/content.json";
import queueFixture from "../../mocks/queue.json";
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

export const MOCK_DATA_NOTICE =
  "Demonstration data only. Documents, checks, findings, sources, and timestamps are fictional and are not verified results.";

export interface DemoAuditEntry {
  id: number;
  at: string;
  actor: string;
  role: Role;
  action: string;
  detail: string;
}

export interface DemoWorkspace {
  knowledge: BrandData;
  documents: Content[];
  queueDocumentIds: number[];
  findings: DemoFinding[];
  history: DemoAuditEntry[];
  persistenceWarning: string | null;
  isHydrated: boolean;
}

export type DemoKnowledgeItem = Guideline | GlossaryTerm | BrandFact | BrandAsset;

const initialDocument: Content = {
  ...contentFixture["GET /api/content/1"],
  status: "in_review",
};
const initialQueue = queueFixture.response;
const initialHistory = auditFixture.response as DemoAuditEntry[];
const initialKnowledge = cloneBrandData(SAMPLE_BRAND);

let workspace: DemoWorkspace = {
  knowledge: initialKnowledge,
  documents: [{ ...initialDocument }],
  queueDocumentIds: initialQueue.map((document) => document.id),
  findings: getDemoFindings(initialDocument.body, initialKnowledge),
  history: initialHistory.map((entry) => ({ ...entry })),
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
): value is Omit<DemoWorkspace, "persistenceWarning" | "isHydrated"> {
  if (!value || typeof value !== "object") return false;
  const stored = value as Partial<DemoWorkspace>;
  return Boolean(
    stored.knowledge &&
      Array.isArray(stored.knowledge.guidelines) &&
      Array.isArray(stored.knowledge.glossary) &&
      Array.isArray(stored.knowledge.facts) &&
      Array.isArray(stored.knowledge.assets) &&
      Array.isArray(stored.documents) &&
      Array.isArray(stored.queueDocumentIds) &&
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
  const queuedIds = new Set(data.queueDocumentIds);
  return data.documents.filter((document) => queuedIds.has(document.id));
}

export function formatMockTimestamp(timestamp: string): string {
  return `${timestampFormatter.format(new Date(timestamp))} UTC`;
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
  const findings = getDemoFindings(DEMO_DRAFT.body, knowledge).map((finding) => {
    const previous = currentFindingsById.get(finding.id);
    return previous
      ? { ...finding, status: previous.status, final_text: previous.final_text }
      : finding;
  });

  commitWorkspace({ ...workspace, knowledge, findings });
}

export function saveMockKnowledgeItem(
  collection: keyof BrandData,
  editingId: string | null,
  values: Record<string, string>,
): void {
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
): void {
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

export function resetMockKnowledge(): void {
  commitKnowledge(cloneBrandData(SAMPLE_BRAND));
}

export function resetDemoDocument(): ResolveDemoFindingResult {
  const document = { ...initialDocument };
  const findings = getDemoFindings(document.body, workspace.knowledge);
  const nextWorkspace: DemoWorkspace = {
    ...workspace,
    documents: workspace.documents.map((item) =>
      item.id === document.id ? document : item,
    ),
    findings,
  };
  commitWorkspace(nextWorkspace);
  return { document, findings };
}

export interface ResolveDemoFindingResult {
  document: Content;
  findings: DemoFinding[];
}

export function resolveDemoFinding(
  findingId: number,
  status: Exclude<FindingStatus, "open">,
  finalText: string | null,
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

  const replacesText = status === "accepted" || status === "edited";
  if (replacesText && !finalText?.trim()) {
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
    updated_at: new Date().toISOString(),
  };
  const actionDetail =
    status === "dismissed"
      ? `Dismissed finding ${finding.id} in ${document.title}.`
      : `${status === "accepted" ? "Accepted" : "Edited"} finding ${finding.id} in ${document.title}.`;
  const nextHistoryId =
    workspace.history.reduce((largestId, entry) => Math.max(largestId, entry.id), 0) +
    1;
  const nextWorkspace: DemoWorkspace = {
    ...workspace,
    documents: workspace.documents.map((item) =>
      item.id === document.id ? updatedDocument : item,
    ),
    findings: updatedFindings,
    history: [
      ...workspace.history,
      {
        id: nextHistoryId,
        at: updatedDocument.updated_at,
        actor: "Asha",
        role: "creator",
        action: status === "dismissed" ? "finding_dismissed" : `finding_${status}`,
        detail: actionDetail,
      },
    ],
  };
  commitWorkspace(nextWorkspace);
  return { document: updatedDocument, findings: updatedFindings };
}

export function recordDemoReview(body: string): DemoFinding[] {
  const findings = getDemoFindings(body, workspace.knowledge);
  if (body !== DEMO_DRAFT.body) return findings;

  const reviewedAt = new Date().toISOString();
  const currentDocument = workspace.documents.find(
    (document) => document.id === DEMO_DRAFT.id,
  );

  if (!currentDocument) {
    throw new Error("The demonstration document is not available.");
  }

  const nextHistoryId =
    workspace.history.reduce((largestId, entry) => Math.max(largestId, entry.id), 0) +
    1;

  const nextWorkspace: DemoWorkspace = {
    ...workspace,
    documents: workspace.documents.map((document) =>
      document.id === currentDocument.id
        ? { ...document, updated_at: reviewedAt }
        : document,
    ),
    findings,
    history: [
      ...workspace.history,
      {
        id: nextHistoryId,
        at: reviewedAt,
        actor: "Asha",
        role: "creator",
        action: "reviewed",
        detail: `Ran the demonstration brand review for ${currentDocument.title}.`,
      },
    ],
  };
  commitWorkspace(nextWorkspace);

  return findings;
}
