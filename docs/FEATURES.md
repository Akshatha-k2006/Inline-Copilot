# Inline Copilot Features

Inline Copilot is a governance workspace for brand content. It helps teams draft marketing copy, validate it against approved brand knowledge, resolve review findings, and manage publication-ready workflows with human oversight.

This document summarizes the product capabilities currently implemented in the project. The API contract in [API_CONTRACT.md](./API_CONTRACT.md) remains the formal source of truth for technical request and response shapes.

## Product Summary

The platform supports four demo roles:

- Creator: drafts and updates content
- Reviewer: evaluates submissions and evidence
- Brand Manager: tracks governance quality and rule performance
- Admin: controls governance setup and operational oversight

The application combines a FastAPI backend, a Next.js frontend, and a review engine that checks content against approved guidelines, terminology, evidence-backed claims, image accessibility requirements, and workflow approval rules.

## Core Capabilities

### 1. Brand Knowledge Management

- Full CRUD support for guidelines, glossary terms, approved facts, and assets
- Structured brand rules for preferred wording, prohibited terminology, factual claims, and asset metadata
- Stored knowledge used directly in review checks and UI guidance
- Knowledge pages support creation, editing, and maintenance of approved governance content

### 2. Content Review and Inline Governance

- Content creation and editing workflows for drafts with version tracking
- State-based publishing flow with statuses such as draft, in review, changes requested, approved, and ready to publish
- Inline review findings that highlight risky copy directly inside the editor
- Human review loop with resolution, dismissal, and re-review requirements

### 3. AI and Rule-Based Review Engine

- Deterministic checks for:
  - prohibited and preferred terminology
  - unsupported or risky claims
  - outdated fact detection
  - tone and messaging issues
- Optional LLM-backed review when an API key is configured
- Findings include severity, source references, explanations, and suggested fixes

### 4. Evidence Request Workflow

- Unsupported claim findings can trigger an evidence request workflow
- Request owners can attach source URLs and evidence context to support a review claim
- Reviewers can verify or decide whether the evidence is acceptable
- Evidence history and decisions are tracked for governance accountability

### 5. Brand Manager Dashboard

- Brand managers and admins can view rule performance over a selected time period
- Dashboard metrics include:
  - active guidelines
  - findings recorded
  - review activity
  - dismissed findings
  - rules needing clarification
- Helps identify guidelines that are frequently cited, dismissed, or under-reviewed

### 6. Image Upload and Accessibility Review

- Users can upload supported images into content and review them in context
- Alternative text can be added and saved for uploaded assets
- Accessibility checking includes image review workflows and contrast validation for foreground/background combinations
- The platform supports UI-level review for text color readability, accessibility-sensitive combinations, and uploaded image content quality

### 7. Approval Workflow and Review Queue

- Structured status transitions enforce role-based next steps
- Review queue surfaces content waiting for decision
- Approvals, changes requests, and comments are persisted as part of the content governance process
- Workflow actions are logged for audit and traceability

### 8. Audit Trail and Governance Visibility

- Every major write action creates audit events for content, findings, review decisions, knowledge updates, and workflow changes
- Audit history supports visibility into what occurred, when it was changed, and by which role
- Access is scoped for demo usage and role-aware workflow visibility

## Feature Status

### Completed and Active

- Brand knowledge library for guidelines, glossary, facts, and assets
- Sample brand loading and repeatable governance seeding
- Role-based navigation and demo access simulation
- Draft authoring, content editing, and version tracking
- Review engine with findings and inline editor support
- Finding lifecycle management: accept, edit, dismiss, and re-review
- Approval workflow and review queue
- Evidence request workflow for unsupported claims
- Brand manager dashboard with rule and review insights
- Image upload and accessibility validation support
- Audit trail for governance events and workflow actions

### Works With Limitations

- Claim detection is rule-based and covers selected patterns rather than every possible marketing claim type
- Access control is demo-grade and relies on header-based role simulation, not secure production authentication
- Some governance and review capabilities are intentionally prototype-level for local validation
- Image and accessibility checks are designed for targeted demo scenarios and continue to evolve

## Planned Enhancements

- Advanced visual consistency checks for imagery and brand assets
- Broader accessibility validation across content and UI patterns
- Enhanced evidence management, including stronger document verification and renewal flows
- Improved guideline health insights and recommendation scoring
- Production-grade authentication and authorization
- Broader integration scenarios for external editorial and marketing workflows

## Notes

Inline Copilot is designed for local demonstration, validation, and content governance workflow prototyping. It intentionally keeps the role system clear and transparent: it simulates identity for local use, but it is not a production authorization model. Human reviewers remain the final decision-makers before publication.

