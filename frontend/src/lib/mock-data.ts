"use client";

import { useSyncExternalStore } from "react";
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
import type { Content, Role } from "./types";

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
};

const listeners = new Set<() => void>();
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

export function useDemoWorkspace(): DemoWorkspace {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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

  workspace = { ...workspace, knowledge, findings };
  notify();
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

export function updateDemoFindings(findings: DemoFinding[]): void {
  workspace = { ...workspace, findings };
  notify();
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

  workspace = {
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
  notify();

  return findings;
}
