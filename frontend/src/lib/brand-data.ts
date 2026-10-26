import assetFixture from "../../mocks/assets.json";
import factsFixture from "../../mocks/facts.json";
import guidelineFixture from "../../mocks/guidelines.json";
import termFixture from "../../mocks/terms.json";

export interface Guideline {
  id: string;
  title: string;
  description: string;
  kind?: string;
}

export type GlossaryStatus = "approved" | "prohibited";

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  preferredTerm: string;
  status?: GlossaryStatus;
  guidelineId?: string;
}

export interface BrandFact {
  id: string;
  claim: string;
  owner: string;
  reviewDate: string;
  source?: string;
  lastReviewed?: string;
}

export interface BrandAsset {
  id: string;
  name: string;
  description: string;
  url: string;
  kind?: string;
  notes?: string;
}

export interface BrandData {
  guidelines: Guideline[];
  glossary: GlossaryTerm[];
  facts: BrandFact[];
  assets: BrandAsset[];
}

export const EMPTY_BRAND_DATA: BrandData = {
  guidelines: [],
  glossary: [],
  facts: [],
  assets: [],
};

export const SAMPLE_BRAND: BrandData = {
  guidelines: guidelineFixture["GET /api/guidelines"].map((guideline) => ({
    id: String(guideline.id),
    title: guideline.title,
    description: guideline.body,
    kind: guideline.kind,
  })),
  glossary: termFixture["GET /api/terms"].map((term) => ({
    id: String(term.id),
    term: term.term,
    definition: term.reason,
    preferredTerm: term.preferred,
    status: term.status === "prohibited" ? "prohibited" : "approved",
    guidelineId: String(term.guideline_id),
  })),
  facts: factsFixture["GET /api/facts"].map((fact) => ({
    id: String(fact.id),
    claim: fact.statement,
    owner: fact.owner,
    reviewDate: fact.review_by,
    source: fact.source,
    lastReviewed: fact.last_reviewed,
  })),
  assets: assetFixture["GET /api/assets"].map((asset) => ({
    id: String(asset.id),
    name: asset.name,
    description: asset.notes,
    url: asset.url,
    kind: asset.kind,
    notes: asset.notes,
  })),
};
