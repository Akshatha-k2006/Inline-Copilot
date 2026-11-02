// Types mirror docs/API_CONTRACT.md. Change the contract first, then this file.

export type Role = "creator" | "reviewer" | "brand_manager" | "admin";

export type ContentStatus =
  | "draft"
  | "self_checked"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "rejected"
  | "ready_to_publish";

export type CheckType =
  | "terminology"
  | "tone"
  | "messaging"
  | "unsupported_claim"
  | "outdated_info"
  | "accessibility";

export type Severity = "high" | "medium" | "low";
export type FindingStatus =
  | "open"
  | "accepted"
  | "edited"
  | "dismissed"
  | "resolved";

export interface Content {
  id: number;
  title: string;
  content_type: string;
  body: string;
  foreground_color: string | null;
  background_color: string | null;
  text_size: "normal" | "large" | null;
  status: ContentStatus;
  version: number;
  reviewed_version: number | null;
  reviewed_at: string | null;
  created_by: string;
  updated_at: string;
}

export interface ContentImage {
  id: number;
  content_id: number;
  filename: string;
  mime_type: string;
  alt_text: string;
  url: string;
  created_at: string;
  updated_at: string;
}

export interface ContrastCheckResponse {
  foreground_color: string;
  background_color: string;
  text_size: "normal" | "large";
  contrast_ratio: number;
  required_ratio: number;
  passes: boolean;
  brand_palette_match: {
    foreground: boolean;
    background: boolean;
  };
  finding: {
    check: string;
    severity: string;
    message: string;
    suggested_fix: string;
  } | null;
  suggested_replacement: {
    foreground_color: string;
    background_color: string;
    contrast_ratio: number;
  } | null;
}

export interface ContentDraft {
  title: string;
  content_type: string;
  body: string;
  foreground_color?: string | null;
  background_color?: string | null;
  text_size?: "normal" | "large" | null;
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
    images: number;
    evidence_requests: number;
    removed_content: number;
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

export interface BrandManagerDashboard {
  period: { days: number; start: string; end: string };
  overview: {
    active_guidelines: number;
    findings: number;
    guidelines_triggered: number;
    reviews: number;
    previous_reviews: number;
    review_change: number;
    dismissed_findings: number;
    guidelines_needing_review: number;
  };
  findings_per_rule: {
    guideline_id: number | null;
    guideline_name: string;
    finding_count: number;
    categories: Record<string, number>;
    last_cited_at: string | null;
  }[];
  frequently_dismissed: {
    guideline_id: number | null;
    guideline_name: string;
    dismissal_count: number;
    decision_count: number;
    dismissal_rate: number | null;
    dismissal_reasons: string[];
  }[];
  not_recently_cited: {
    guideline_id: number;
    guideline_name: string;
    last_citation_at: string | null;
    last_reviewed_at: string | null;
    reason: string;
  }[];
  not_recently_reviewed: {
    guideline_id: number;
    guideline_name: string;
    last_reviewed_at: string | null;
    reason: string;
  }[];
  clarifications: {
    guideline_id: number | null;
    guideline_name: string;
    suggestion: string;
    reason: string;
    dismissal_count: number;
    status: string;
  }[];
}

export interface BackendFinding {
  id: number;
  check: string;
  guideline_id: number | null;
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

export type EvidenceRequestStatus = "open" | "fulfilled" | "dismissed";

export interface EvidenceRequest {
  id: number;
  claimText: string;
  findingId: number;
  reason: string;
  assignee: string;
  status: EvidenceRequestStatus;
  createdAt: string;
  updatedAt: string;
  sourceType: "url" | "document" | null;
  sourceUrl: string | null;
  documentName: string | null;
  documentType: string | null;
  evidenceDescription: string | null;
  ownerExplanation: string | null;
  attachedBy: string | null;
  attachedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  decision: "approved" | "rejected" | null;
  reviewerFeedback: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface EvidenceActivity {
  id: number;
  eventType: string;
  actor: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface FindingSource {
  type: "term" | "guideline" | "fact" | "accessibility";
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
  accessibility?: {
    image_id?: number;
    image_filename?: string;
    foreground_color?: string;
    background_color?: string;
    contrast_ratio?: number;
    required_ratio?: number;
    text_size?: string;
  };
}

export interface Health {
  status: string;
}
