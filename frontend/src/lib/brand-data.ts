export interface Guideline {
  id: string;
  title: string;
  description: string;
  category?: string;
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
  outdated?: boolean;
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

