import type { Content, Finding, Role } from "./types";

export interface DemoReviewSnapshot {
  document_id: number;
  document_version: number;
  body: string;
  reviewed_at: string;
  scope: "known_demo_checks";
}

export interface WorkflowFinding extends Finding {
  range_valid?: boolean;
}

export function canViewReviewQueue(role: Role): boolean {
  return role !== "creator";
}

export function canManageKnowledge(role: Role): boolean {
  return role === "brand_manager" || role === "admin";
}

export function canDecideReview(role: Role): boolean {
  return role === "reviewer";
}

export function canEditContent(
  role: Role,
  user: string,
  document: Content,
): boolean {
  const name = user.replace(/\s+\([^)]*\)$/, "");
  return (
    role === "creator" &&
    name === document.created_by &&
    (document.status === "draft" || document.status === "changes_requested")
  );
}

export function reviewIsCurrent(
  document: Content,
  review: DemoReviewSnapshot | undefined,
): boolean {
  return Boolean(
    review &&
      review.document_id === document.id &&
      review.document_version === document.version &&
      review.body === document.body,
  );
}

export function getSubmissionBlockers(
  document: Content,
  review: DemoReviewSnapshot | undefined,
  findings: WorkflowFinding[],
): string[] {
  const blockers: string[] = [];
  if (!document.title.trim()) blockers.push("Add a document title before submission.");
  if (!document.body.trim()) blockers.push("Add content before submission.");
  if (!reviewIsCurrent(document, review)) {
    blockers.push("Run a new demonstration review because this document has changed.");
  }

  const blockingFindings = findings.filter(
    (finding) =>
      finding.content_id === document.id &&
      finding.severity === "high" &&
      (finding.status === "open" ||
        ((finding.status === "dismissed" ||
          (finding.status === "accepted" && !finding.final_text)) &&
        (finding.status === "dismissed" &&
          document.body
            .toLocaleLowerCase()
            .includes(finding.text.toLocaleLowerCase()))),
  );
  if (blockingFindings.length > 0) {
    blockers.push(
      `${blockingFindings.length} high-severity finding${blockingFindings.length === 1 ? "" : "s"} still need correction. Accepting without a replacement or dismissing a finding does not correct its text.`,
      `${blockingFindings.length} high-severity finding${blockingFindings.length === 1 ? "" : "s"} still need correction. Dismissing a finding does not resolve it.`,
    );
  }
  return blockers;
}

export function contentStatusLabel(status: Content["status"]): string {
  const labels: Record<Content["status"], string> = {
    draft: "Draft",
    in_review: "In Review",
    changes_requested: "Changes Requested",
    approved: "Approved",
    ready_to_publish: "Ready to publish",
  };
  return labels[status];
}
