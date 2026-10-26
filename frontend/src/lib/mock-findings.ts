import contentFixture from "../../mocks/content.json";
import reviewFixture from "../../mocks/review.json";
import type {
  BrandData,
  BrandFact,
  GlossaryTerm,
  Guideline,
} from "./brand-data";
import type { Finding } from "./types";

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
};

export const DEMO_DRAFT = contentFixture["POST /api/content"];

const fixtureFindings = reviewFixture.response.findings as Finding[];

function findKnowledgeSource(
  source: Finding["source"],
  knowledge: BrandData,
): DemoKnowledgeSource | undefined {
  if (!source) return undefined;

  if (source.type === "guideline") {
    const record = knowledge.guidelines.find((item) => Number(item.id) === source.id);
    return record ? { type: "guideline", record } : undefined;
  }

  if (source.type === "term") {
    const record = knowledge.glossary.find((item) => Number(item.id) === source.id);
    return record ? { type: "term", record } : undefined;
  }

  const record = knowledge.facts.find((item) => Number(item.id) === source.id);
  return record ? { type: "fact", record } : undefined;
}

function sourceLabel(source: DemoKnowledgeSource): string {
  if (source.type === "guideline") return `Guideline: ${source.record.title}`;
  if (source.type === "fact") return `Fact: ${source.record.claim}`;
  return `Glossary: ${source.record.term}${
    source.record.preferredTerm ? ` → ${source.record.preferredTerm}` : ""
  }`;
}

function matchesCurrentMockRule(
  finding: Finding,
  source: DemoKnowledgeSource,
): boolean {
  if (source.type === "term") {
    return (
      source.record.status === "prohibited" &&
      finding.text.toLocaleLowerCase() === source.record.term.toLocaleLowerCase()
    );
  }

  if (finding.check === "outdated_info" && source.type === "fact") {
    return source.record.reviewDate < new Date().toISOString().slice(0, 10);
  }

  if (source.type === "guideline") {
    return /superlative|number one|best|ranking|comparison/i.test(
      source.record.description,
    );
  }

  return true;
}

function currentExplanation(
  finding: Finding,
  source: DemoKnowledgeSource,
): string | undefined {
  if (source.type === "term") return source.record.definition;
  if (finding.check === "outdated_info" && source.type === "fact") {
    return `The supporting fact is past its review date (${source.record.reviewDate}) and must be re-approved before use.`;
  }
  return finding.explanation;
}

function currentSuggestion(
  finding: Finding,
  source: DemoKnowledgeSource,
): string | null | undefined {
  if (source.type === "term") return source.record.preferredTerm;
  if (source.type === "fact") return null;
  return finding.suggestion;
}

export function isReplacementSuggestion(value: string | null | undefined): value is string {
  return Boolean(
    value?.trim() &&
      !/^(remove|verify|use the approved claim|use the current mock fact|replace|rewrite)\b/i.test(
        value.trim(),
      ),
  );
}

export function getDemoFindings(
  body: string,
  knowledge: BrandData,
): DemoFinding[] {
  if (body !== DEMO_DRAFT.body) return [];

  return fixtureFindings.flatMap((finding) => {
    const knowledgeSource = findKnowledgeSource(finding.source, knowledge);
    if (!knowledgeSource || !matchesCurrentMockRule(finding, knowledgeSource)) {
      return [];
    }

    const fact =
      knowledgeSource.type === "fact" ? knowledgeSource.record : undefined;
    const source = finding.source
      ? { ...finding.source, label: sourceLabel(knowledgeSource) }
      : undefined;
    const explanation = currentExplanation(finding, knowledgeSource);
    const suggestion = currentSuggestion(finding, knowledgeSource);

    return [{
      ...finding,
      source,
      explanation,
      suggestion,
      knowledge_source: knowledgeSource,
      fact_details: fact
        ? {
            owner: fact.owner,
            review_date: fact.reviewDate,
            last_reviewed: fact.lastReviewed,
            source: fact.source,
          }
        : undefined,
    }];
  });
}

export const DEMO_FINDINGS_NOTICE =
  "Demonstration data only. These fictional sample findings are not verified analysis.";

export const CUSTOM_CONTENT_NOTICE =
  "No demonstration findings are available for custom text. This is not a live content review.";
