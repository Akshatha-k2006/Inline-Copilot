# Inline Copilot Product Audit

This is the repository-to-requirement audit recorded before implementation
changes in this pass. The status tables below describe that baseline;
implementation updates and current limitations are recorded at the end.
“Verified” in the baseline refers to source inspection and the baseline
frontend build; the backend test suite could not run because its Python
dependencies were not installed at that time.

| Capability | Baseline status | Evidence and gap |
|---|---|---|
| Application stack and persistence | Partially implemented | Next.js/React/TypeScript frontend and FastAPI/SQLAlchemy backend are present. `backend/app/db.py` supports the configured SQLAlchemy URL and creates tables at startup, but schema changes use an ad-hoc migration function rather than a migration system. |
| Four-role authorization | Broken for production | `frontend/src/lib/role.tsx` and `RoleSwitcher.tsx` store a selectable role in browser storage. `backend/app/dependencies.py` trusts `X-Role`; content routes also trust `X-User`. These headers do not authenticate a caller. |
| Primary navigation | Partially implemented | `frontend/src/components/TopBar.tsx` has five items, including a separate Review queue, instead of the four requested primary destinations. |
| Content create, edit, checks, findings | Partially implemented | `frontend/src/components/editor/Editor.tsx`, `backend/app/routers/content.py`, and `backend/app/routers/review.py` persist content and versioned findings. Checks use stored prohibited terms and facts plus an optional LLM, but not all seven requested categories are supported. |
| Submission and review workflow | Partially implemented | `backend/app/services/content_workflow.py` validates transitions and records content audit events. Requesting changes returns content to `draft`; authorization still depends on spoofable headers. |
| Brand knowledge management | Partially implemented | CRUD routers exist for guidelines, terms, facts, and assets. API schemas omit useful supported model fields such as term status, fact source, and asset type; guidelines are returned to the checking engine, while stored asset metadata is not checked. |
| Lumina Home seed data | Broken / destructive | `backend/app/routers/seed.py` deletes existing guidelines, terms, facts, and assets before inserting fixed IDs and sample content. Re-running is not safe for user-created records. |
| Audit Trails | Partially implemented | Content changes, checks, comments, and workflow transitions create `AuditEvent` rows. Knowledge CRUD does not record events; `backend/app/routers/content.py` scopes the creator's event list to owned content. |
| Role-specific Home dashboards | Partially implemented | `frontend/src/app/page.tsx` has role-specific copy and live-data sections. A pre-existing worktree edit removed its data-loading effect, leaving those sections without backend data. It has been preserved pending the user's approval to restore loading. |
| Reviewer workspace | Partially implemented | `frontend/src/app/queue/page.tsx` loads submissions and supports reviewer comments and decisions, but remains a separate primary navigation destination. |
| Deployment and API URL configuration | Partially implemented | `frontend/src/lib/api.ts` uses `NEXT_PUBLIC_API_BASE_URL`, permits a localhost fallback only in development, and reports a missing production URL. No deployment manifests or database migration framework were found. |
| Automated verification | Partially implemented | Backend tests exist under `backend/tests`. The baseline frontend production build passed. Backend tests could not import FastAPI/SQLAlchemy in the current Python environment; `pytest` is also not installed. |

## Checking-category coverage at baseline

| Category | Baseline status |
|---|---|
| Tone | Partial; prohibited terminology is deterministic, and broader tone review requires a configured LLM. |
| Terminology | Implemented from stored prohibited terms. |
| Messaging | Partial; requires a configured LLM. |
| Visual consistency | Missing; asset metadata is not evaluated. |
| Accessibility | Missing; no supported document accessibility checks are implemented. |
| Unsupported claims | Partial; deterministic checks cover selected numbers, customer counts, superlatives, and guarantees. |
| Outdated information | Partial; claim checking compares fact review dates, but coverage is limited to recognized claim patterns. |

## Repository safety

The worktree initially contained pre-existing changes in
`frontend/src/app/page.tsx` and `frontend/next-env.d.ts`, with no unresolved
merge conflicts. The Home-page data-loading change was confirmed with the user
and restored; the `next-env.d.ts` change is unrelated and remains untouched.

## Implementation updates

- Production API routes that depend on a user role now return
  `401 authentication_not_configured` until a real identity provider is
  integrated. Development role headers are restricted to loopback clients;
  they are not production authentication.
- Primary navigation now has four destinations. The Home dashboard reloads
  backend data and derives its role-specific metrics and recent activity from
  content, knowledge, and audit records.
- Knowledge APIs and forms expose the requested guideline category,
  terminology status and guideline relation, fact source and review dates,
  and asset type. Knowledge create, update, and delete operations record
  audit events.
- Lumina sample seeding adds only missing records, preserves existing
  records, resolves linked records dynamically, and records the seed load.
- Deterministic terminology, selected claim, and exclamation-mark checks use
  stored knowledge. Finding evidence includes valid source-record references;
  optional LLM checks remain dependent on external configuration.
- Startup schema updates add terminology guideline links and fact review
  dates. The project still has no versioned migration framework.
- Backend tests and the frontend production build were run after the
  implementation; the final backend test run is documented in the delivery
  summary.

## Remaining limitations

- No OIDC/JWT identity provider, login, or account management is implemented.
  Production API actions are intentionally unavailable until a trusted
  identity boundary is configured.
- Visual consistency and accessibility checks are not implemented.
  Messaging and broader semantic tone checks require an optional configured
  LLM; deterministic checks cover only specific stored-data-backed rules.
- Claim checks recognize selected patterns rather than all possible claims.
  No production database or deployment environment was available for
  verification.
