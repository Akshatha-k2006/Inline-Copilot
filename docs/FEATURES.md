# Inline Copilot features

What Inline Copilot can do right now, what works with caveats, and what is
planned. The API contract in `docs/API_CONTRACT.md` is the source of truth for
endpoints and JSON shapes; this file describes the product-level behaviour.

Inline Copilot is a governance workspace for brand content. Creators draft
marketing copy and check it inline against approved brand knowledge before it
can be submitted; reviewers approve or request changes; brand managers and
admins move approved work to publishable. Everything runs on the FastAPI
backend with a Next.js frontend; there is no login — a demo role switcher
sends `X-Role` and `X-User` headers (demo only, not authentication).

## Completed

### Brand knowledge library

- Full CRUD for guidelines, glossary terms, approved facts, and assets
  (`/api/guidelines`, `/api/glossary`, `/api/facts`, `/api/assets`).
- Guidelines have an optional category; terms have a status, preferred wording,
  and optional guideline link; facts have an owner, source, and review dates
  with an `outdated` marker; assets have a type.
- Every knowledge create, update, and delete writes a workspace-level audit
  event in the same transaction.
- The Knowledge screen shows all four collections as tabs (Guidelines,
  Terminology, Approved facts, Assets) with working forms.

### Sample brand seeding

- `POST /api/seed/load` loads the fictional Lumina brand from `seed/brand.json`.
- Seeding is additive: it creates only missing records by natural key and never
  overwrites or deletes user-created records, so it can be re-run safely.
- Restricted to admin and brand manager; each load is itself an audit event.

### Demo roles and navigation

- Four roles — creator, reviewer, brand manager, admin — switched in the top
  bar. Changing role returns to the home page.
- Role-specific home dashboards with live metrics and recent activity derived
  from content, knowledge, and audit records.
- Navigation and pages adapt to role; role-restricted pages redirect home
  (creators cannot enter the review queue, non-brand-manager roles cannot see
  the audit trail).
- Authorisation uses caller-supplied `X-Role`/`X-User` headers validated by the
  backend. This is demo context, not authentication, and must not be exposed as
  a secured multi-user service.

### Content workspace (inline editor)

- Creators create drafts (`body` may be empty; the editor shows its own
  placeholder), edit draft bodies and titles, and delete their own drafts.
- Every save increments the version with optimistic locking (stale versions
  return `409`) and clears the reviewed-version marker.
- Creators see only their own documents; reviewers and managers see everything.
- "My documents" list cards show state rails (draft / in review / changes
  requested / approved / ready to publish), word count, version, and a count
  badge; the list scrolls inside the card.
- A document title area, word/read-time counters, and the active status pill.

### Review engine

- `POST /api/content/{id}/review` runs all checks and persists findings for the
  current content version with `reviewed_version`/`reviewed_at` markers and a
  `content_reviewed` audit event.
- Deterministic, knowledge-backed checks run first: prohibited and preferred
  terminology from stored terms; unsupported claims (superlatives, guarantees,
  selected numbers) matched against approved facts; outdated-fact detection by
  review dates; tone rules such as exclamation-mark overuse.
- Findings always cite the guideline, term, or fact they came from, and carry
  severity, message, text offsets, and a suggested fix where one exists.
- An optional hosted LLM reviews tone, messaging, and claim wording when
  `LLM_API_KEY` is configured. Rule results are always returned; the response's
  `engine` field reports `llm` as `ok`, `timeout`, `error`, or `disabled`, and
  the UI surfaces non-ok states instead of pretending the review was clean.

### Findings in the editor

- The findings panel shows open-finding counts as severity chips (errors /
  warnings / info), one card per finding with severity colour, check name,
  original text, suggested replacement, explanation, source, cited knowledge,
  and fact details, and distinct empty states for "not run", "stale" (the draft
  changed after its last review), "review error", and clean reviews.
- Inline highlights overlay open findings on the reviewed text, linked to the
  findings list; the editable textarea is the default mode, with an explicit
  "Show highlights" / "Edit text" toggle (open findings only — resolved
  findings never lock the editor).
- Resolved findings (8) stay available, collapsed behind a summary expander.

### Finding resolution

- `PATCH /api/findings/{id}` supports accept (apply the suggested fix),
  edit-with-replacement, and dismiss with a required dismissal reason
  (not applicable / context explains the claim / approved exception / false
  positive).
- Replacements are applied only to the verified text span; stale or overlapping
  spans are rejected rather than corrupting the document, and unaffected
  findings advance to the new version when their spans still match.
- Accept and edit bump the content version and require re-review; dismiss does
  not change the content. Every action is recorded as
  `finding_accepted` / `finding_edited` / `finding_dismissed` audit events.

### Creator feedback loop

- Reviewer "Request changes" returns the content to `draft` with a required
  comment; the comment is persisted.
- The creator sees a feedback card naming the document, its version, the
  reviewer notes, and the changes-requested state, and submit stays hidden
  until the draft is edited and re-reviewed, so old comments can never be
  falsely "resolved".

### Approval workflow

- Status path `draft → self_checked → in_review → approved → ready_to_publish`
  enforced by the shared transition service with per-role authorization.
- Self-check/submit requires a persisted review of the current version and no
  open high-severity findings; submission is also blocked when a resolved
  finding's flagged text is still present, with `409` and a clear message.
- Reviewers approve or request changes via the review queue with optional or
  required comments; brand managers and admins perform the
  approved → ready-to-publish transition.
- Every transition writes exactly one `content_status_changed` audit event
  atomically with the change.

### Review queue and audit trail

- The review queue lists submissions awaiting review for reviewers/managers,
  supports the approve / request-changes decisions, and shows comments.
- The audit trail shows workspace activity (content, finding, knowledge, and
  workflow events), scoped so creators see only their own content's events.
- Every write — content edits, reviews, finding actions, decisions, comments,
  knowledge CRUD, seed loads — produces an audit event.

### Editor UI details

- Success notices ("Full review completed…", "Document created.", "Draft saved
  to the backend.") auto-clear after five seconds; errors persist until the
  next action.
- Backend connectivity status is shown from a backend health indicator.
- Draft deletion is confirmed in the UI and hidden during draft creation.

## Partial (works, with limits)

- **Claim coverage** recognizes selected patterns (superlatives, guarantees,
  customer numbers, percentages) rather than all possible claims. Text the
  patterns do not match is not checked.
- **Access control is demo-grade** `X-Role`/`X-User` header simulation. It is
  validated and enforced, but impersonation is possible and expected — the
  target environment is local demonstration and testing.
- **Facts and claim checks** use review dates and approved-fact matching but
  no evidence attachments or re-approval workflow yet.

## Planned

- **Visual consistency checks** — evaluating stored assets and brand
  guidelines for imagery (no `visual` check exists yet).
- **Accessibility checks** of content.
- **Evidence management for facts** — evidence requests, attachments, and a
  re-approval flow for facts past their review date.
- **Guideline health insights** — usage counts and decision outcomes from
  findings and decisions.
- **Google Docs add-on** reusing the same `POST /review` API.
- Production authentication to replace the demo header scheme.

## Verification status

- Backend: 100 unit tests (`backend/tests`, run with `python -m unittest
discover -s tests`), covering health, collection CRUD, content, review,
  finding actions, workflow transitions, comments, audit, seeding, and engine
  checks against `seed/brand.json`. One assertion in `test_review_llm` currently
  fails because it hard-codes the `gemini-2.5-flash` model name while the
  configured model is `gemini-3.8-flash`; the review itself works.
- Frontend: `npx tsc --noEmit` and `npm run build` pass; editor flows are
  exercised in a real browser (creation, review, resolution, submit gating,
  role switching, and notice timing).
