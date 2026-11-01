import type { BrandData, BrandFact, GlossaryTerm, Guideline } from "./brand-data";
import type {
  BackendFinding,
  CheckType,
  Finding,
  FindingStatus,
  Severity,
} from "./types";

export interface DemoFactDetails {
  owner: string;
  review_date: string;
  last_reviewed?: string;
  source?: string;
}

export type DemoKnowledgeSource =
  | { type: "guideline"; record: Guideline }
  | { type: "term"; record: GlossaryTerm }
  | { type: "fact"; record: BrandFact };

export type DemoFinding = Finding & {
  knowledge_source: DemoKnowledgeSource;
  fact_details?: DemoFactDetails;
  range_valid?: boolean;
  content_version?: number;
};

export function isReplacementSuggestion(
  value: string | null | undefined,
): value is string {
  return Boolean(
    value?.trim() &&
      !/^(remove|verify|use the approved claim|use the current mock fact|replace|rewrite)\b/i.test(
        value.trim(),
      ),
  );
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function severityFromBackend(value: string): Severity {
  switch (value.toLowerCase()) {
    case "high":
    case "error":
      return "high";
    case "low":
    case "info":
      return "low";
    case "medium":
    case "warning":
    default:
      return "medium";
  }
}

function statusFromBackend(value: string): FindingStatus {
  switch (value) {
    case "accepted":
    case "edited":
    case "dismissed":
    case "resolved":
      return value;
    default:
      return "open";
  }
}

function checkFromBackend(value: string): CheckType {
  switch (value) {
    case "terminology":
    case "tone":
    case "messaging":
    case "unsupported_claim":
    case "outdated_info":
      return value;
    case "accessibility":
      return value;
    default:
      return "messaging";
  }
}

function sourceLabel(source: DemoKnowledgeSource): string {
  if (source.type === "guideline") return `Guideline: ${source.record.title}`;
  if (source.type === "fact") return `Fact: ${source.record.claim}`;
  return `Glossary: ${source.record.term}${
    source.record.preferredTerm ? ` → ${source.record.preferredTerm}` : ""
  }`;
}

function fallbackTerm(
  sourceId: number,
  source: Record<string, unknown>,
  matchedText: string,
  message: string,
  suggestedFix: string | null,
): GlossaryTerm {
  return {
    id: String(sourceId || 0),
    term: asText(source.term, matchedText || "Term"),
    definition: asText(source.explanation, message),
    preferredTerm: asText(source.preferred_term, suggestedFix ?? ""),
    status: source.status === "approved" ? "approved" : "prohibited",
    guidelineId:
      source.guideline_id === null || source.guideline_id === undefined
        ? ""
        : String(source.guideline_id),
  };
}

function fallbackFact(
  sourceId: number,
  source: Record<string, unknown>,
  matchedText: string,
  check: string,
): BrandFact {
  return {
    id: String(sourceId || 0),
    claim: asText(source.text, matchedText || "Approved fact"),
    owner: asText(source.owner, "Unknown owner"),
    reviewDate: asText(source.review_by, ""),
    source: asText(source.citation, ""),
    lastReviewed: asOptionalText(source.last_reviewed),
    outdated: check === "outdated_info",
  };
}

function fallbackGuideline(
  sourceId: number,
  source: Record<string, unknown>,
  message: string,
): Guideline {
  return {
    id: String(sourceId || 0),
    title: asText(source.title, "Brand guideline"),
    description: asText(source.text, message),
    category: asText(source.category, ""),
  };
}

/**
 * Converts the backend finding shape into the shape used by the editor
 * components. Backend findings always carry evidence, so the knowledge source
 * is resolved from the backend-loaded brand data first and from the finding
 * evidence when a record has since changed.
 */
export function toDemoFinding(
  finding: BackendFinding,
  contentId: number,
  knowledge: BrandData,
  fallbackVersion?: number,
): DemoFinding {
  const evidence = asRecord(finding.evidence);
  const source = asRecord(evidence.source);
  const matchedText = asText(evidence.matched_text);
  const message = asText(finding.message);
  const status = statusFromBackend(finding.status);
  const check = checkFromBackend(finding.check);
  const sourceType = asText(source.type).toLowerCase();
  const numericId = Number(source.id);
  const sourceId = Number.isFinite(numericId) ? numericId : 0;
  const suggestedFix =
    typeof finding.suggested_fix === "string" ? finding.suggested_fix : null;

  let knowledgeSource: DemoKnowledgeSource;

  if (sourceType === "glossary" || sourceType === "term") {
    const record = knowledge.glossary.find(
      (item) => Number(item.id) === sourceId,
    );
    knowledgeSource = {
      type: "term",
      record:
        record ??
        fallbackTerm(sourceId, source, matchedText, message, suggestedFix),
    };
  } else if (sourceType === "fact") {
    const record = knowledge.facts.find((item) => Number(item.id) === sourceId);
    knowledgeSource = {
      type: "fact",
      record: record ?? fallbackFact(sourceId, source, matchedText, finding.check),
    };
  } else {
    const record = knowledge.guidelines.find(
      (item) => Number(item.id) === sourceId,
    );
    knowledgeSource = {
      type: "guideline",
      record: record ?? fallbackGuideline(sourceId, source, message),
    };
  }

  const start = Number.isInteger(finding.start_offset)
    ? (finding.start_offset as number)
    : 0;
  const end = Number.isInteger(finding.end_offset)
    ? (finding.end_offset as number)
    : 0;
  const rangeValid = Boolean(matchedText) && start >= 0 && start < end;
  const factDetails =
    knowledgeSource.type === "fact"
      ? {
          owner: asText(source.owner, knowledgeSource.record.owner),
          review_date: asText(
            source.review_by,
            knowledgeSource.record.reviewDate,
          ),
          last_reviewed:
            asOptionalText(source.last_reviewed) ??
            knowledgeSource.record.lastReviewed,
          source: asText(source.citation, knowledgeSource.record.source),
        }
      : undefined;
  const contrast = asRecord(evidence.contrast);
  const accessibility =
    sourceType === "image"
      ? {
          image_id: sourceId,
          image_filename: asText(source.text, matchedText),
        }
      : sourceType === "contrast"
        ? {
            foreground_color: asText(contrast.foreground_color),
            background_color: asText(contrast.background_color),
            contrast_ratio:
              typeof contrast.contrast_ratio === "number"
                ? contrast.contrast_ratio
                : undefined,
            required_ratio:
              typeof contrast.required_ratio === "number"
                ? contrast.required_ratio
                : undefined,
            text_size: asText(contrast.text_size),
          }
        : undefined;
  const displaySource =
    sourceType === "image" || sourceType === "contrast"
      ? {
          type: "accessibility" as const,
          id: sourceId,
          label: "Accessibility check",
        }
      : {
          type: knowledgeSource.type,
          id: sourceId,
          label: sourceLabel(knowledgeSource),
        };

  return {
    id: finding.id,
    content_id: contentId,
    check,
    severity: severityFromBackend(finding.severity),
    start,
    end,
    text: matchedText || message,
    explanation: message,
    source: displaySource,
    suggestion: suggestedFix,
    status,
    final_text:
      status === "accepted" ? suggestedFix ?? (matchedText || null) : null,
    knowledge_source: knowledgeSource,
    fact_details: factDetails,
    range_valid: rangeValid,
    content_version: finding.content_version ?? fallbackVersion,
    accessibility,
  };
}
