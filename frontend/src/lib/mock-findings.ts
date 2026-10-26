import contentFixture from "../../mocks/content.json";
import factsFixture from "../../mocks/facts.json";
import reviewFixture from "../../mocks/review.json";
import type { Finding } from "./types";

export interface DemoFactDetails {
  owner: string;
  review_date: string;
}

export type DemoFinding = Finding & {
  fact_details?: DemoFactDetails;
};

export const DEMO_DRAFT = contentFixture["POST /api/content"];

const factRecords = factsFixture["GET /api/facts"];

const factsById = new Map(
  factRecords.map((fact) => [
    fact.id,
    { owner: fact.owner, review_date: fact.review_by },
  ]),
);

const fixtureFindings = reviewFixture.response.findings as Finding[];

export function getDemoFindings(body: string): DemoFinding[] {
  if (body !== DEMO_DRAFT.body) return [];

  return fixtureFindings.map((finding) => ({
    ...finding,
    fact_details:
      finding.source?.type === "fact"
        ? factsById.get(finding.source.id)
        : undefined,
  }));
}

export const DEMO_FINDINGS_NOTICE =
  "Demonstration data only. These fictional sample findings are not verified analysis.";

export const CUSTOM_CONTENT_NOTICE =
  "No demonstration findings are available for custom text. This is not a live content review.";
