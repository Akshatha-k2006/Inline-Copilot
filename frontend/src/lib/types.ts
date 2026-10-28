// Types mirror docs/API_CONTRACT.md. Change the contract first, then this file.

export type Role = "creator" | "reviewer" | "brand_manager" | "admin";

export type ContentStatus =
  | "draft"
  | "self_checked"
  | "in_review"
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
  content_type: string;
  body: string;
  status: ContentStatus;
  version: number;
  reviewed_version: number | null;
  reviewed_at: string | null;
  created_by: string;
  updated_at: string;
}

export interface ContentDraft {
  title: string;
  content_type: string;
  body: string;
}

export interface ContentUpdate extends ContentDraft {
  version: number;
}

export interface ContentAuditEvent {
  id: number;
  content_id: number | null;
  actor: string;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface SeedResponse {
  message: string;
  brand: string;
  counts: {
    guidelines: number;
    terms: number;
    facts: number;
    assets: number;
    content: number;
  };
  expired_fact_id: number;
  sample_content_id: number;
}

export interface ApiGuideline {
  id: number;
  title: string;
  description: string;
  category: string;
}

export interface ApiGlossaryTerm {
  id: number;
  term: string;
  definition: string;
  preferredTerm: string | null;
  status: "approved" | "prohibited";
  guidelineId: number | null;
}

export interface ApiFact {
  id: number;
  claim: string;
  owner: string;
  reviewDate: string | null;
  source: string;
  lastReviewed: string | null;
  outdated: boolean;
}

export type ApiFactInput = Omit<ApiFact, "id" | "outdated"> & {
  reviewDate: string;
};

export interface ApiAsset {
  id: number;
  name: string;
  description: string;
  url: string | null;
  assetType: string;
}

export interface BackendFinding {
  id: number;
  check: string;
  severity: string;
  message: string;
  evidence: {
    matched_text: string;
    source: Record<string, unknown>;
    requires_manual_review: boolean;
    suggestion_source?: Record<string, unknown>;
  };
  suggested_fix: string | null;
  start_offset: number | null;
  end_offset: number | null;
  status: string;
  content_version?: number;
}

export interface ContentFindingsResponse {
  content_id: number;
  content_version: number;
  reviewed_version: number | null;
  findings: BackendFinding[];
}

export interface ReviewResponse {
  content_id: number;
  content_version: number;
  findings: BackendFinding[];
  engine: {
    rules: string;
    llm: string;
  };
}

export interface FindingActionResponse {
  content_id: number;
  content_version: number;
  finding: BackendFinding;
}

export interface ContentStatusResponse {
  content_id: number;
  status: string;
  content_version: number;
}

export interface ReviewComment {
  id: number;
  author: string;
  body: string;
  created_at: string;
}

export interface ReviewDecisionResponse extends ContentStatusResponse {
  comment: ReviewComment | null;
}

export interface ContentCommentsResponse {
  content_id: number;
  comments: ReviewComment[];
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
  text: string;
  explanation?: string;
  source?: FindingSource;
  suggestion?: string | null;
  status: FindingStatus;
  final_text?: string | null;
}

export interface Health {
  status: string;
}
