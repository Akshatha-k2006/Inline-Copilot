// Types mirror docs/API_CONTRACT.md. Change the contract first, then this file.

export type Role = "creator" | "reviewer" | "brand_manager" | "admin";

export type ContentStatus =
  | "draft"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "ready_to_publish";

export type CheckType =
  | "terminology"
  | "tone"
  | "messaging"
  | "unsupported_claim"
  | "outdated_info";

export type Severity = "high" | "medium" | "low";
export type FindingStatus = "open" | "accepted" | "edited" | "dismissed";

export interface Content {
  id: number;
  title: string;
  body: string;
  status: ContentStatus;
  version: number;
  created_by: string;
  updated_at: string;
}

export interface ContentDraft {
  title: string;
  body: string;
}

export interface SeedResponse {
  content_id: number;
}

export interface ReviewResponse {
  content_id: number;
  content_version: number;
  findings: Finding[];
  engine?: {
    rules?: string;
    llm?: string;
  };
}

export interface FindingSource {
  type: "term" | "guideline" | "fact";
  id: number;
  label: string;
}

export interface Finding {
  id: number;
  content_id: number;
  check: CheckType;
  severity: Severity;
  start: number;
  end: number;
  start_offset?: number;
  end_offset?: number;
  text: string;
  explanation?: string;
  message?: string;
  evidence?: {
    matched_text?: string;
    source?: Record<string, unknown>;
    [key: string]: unknown;
  };
  source?: FindingSource;
  suggestion?: string | null;
  suggested_fix?: string | null;
  status: FindingStatus;
  final_text?: string | null;
}

export interface BrandResponse {
  brand: string;
  guidelines: import("./brand-data").Guideline[];
  glossary: import("./brand-data").GlossaryTerm[];
  facts: import("./brand-data").BrandFact[];
  assets: import("./brand-data").BrandAsset[];
}

export interface Health {
  status: string;
}
