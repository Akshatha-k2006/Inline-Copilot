export interface Guideline {
  id: string;
  title: string;
  description: string;
}

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  preferredTerm: string;
}

export interface BrandFact {
  id: string;
  claim: string;
  owner: string;
  reviewDate: string;
}

export interface BrandAsset {
  id: string;
  name: string;
  description: string;
  url: string;
}

export interface BrandData {
  guidelines: Guideline[];
  glossary: GlossaryTerm[];
  facts: BrandFact[];
  assets: BrandAsset[];
}

export const BRAND_DATA_EVENT = "inline-copilot-brand-data-updated";

export const EMPTY_BRAND_DATA: BrandData = {
  guidelines: [],
  glossary: [],
  facts: [],
  assets: [],
};

export const SAMPLE_BRAND: BrandData = {
  guidelines: [
    {
      id: "sample-guideline-1",
      title: "Be clear and useful",
      description:
        "Use plain language, lead with the customer benefit, and keep sentences concise.",
    },
    {
      id: "sample-guideline-2",
      title: "Keep claims evidence-based",
      description:
        "Only make product claims supported by an approved, current fact.",
    },
  ],
  glossary: [
    {
      id: "sample-glossary-1",
      term: "Northstar account",
      definition: "A customer's primary account in the Northstar platform.",
      preferredTerm: "Northstar account",
    },
    {
      id: "sample-glossary-2",
      term: "Instant",
      definition:
        "Avoid this term unless a measured, approved fact supports it.",
      preferredTerm: "Fast",
    },
  ],
  facts: [
    {
      id: "sample-fact-1",
      claim: "Northstar supports teams in 12 countries.",
      owner: "Product team",
      reviewDate: "2027-01-15",
    },
    {
      id: "sample-fact-2",
      claim: "Northstar launched in 2022.",
      owner: "Brand team",
      reviewDate: "2025-01-15",
    },
  ],
  assets: [
    {
      id: "sample-asset-1",
      name: "Northstar logo",
      description: "Primary logo for light backgrounds.",
      url: "https://example.com/northstar-logo.svg",
    },
    {
      id: "sample-asset-2",
      name: "Product screenshots",
      description: "Approved screenshots for product announcements.",
      url: "",
    },
  ],
};
