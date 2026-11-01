# Knowledge base API

Resource identifiers are integer database IDs. The frontend sends `X-Role`
and `X-User` to simulate a demo role and actor. The backend validates these
values and applies the demo workflow rules, but caller-supplied headers are not
authentication and do not provide secure authorization. This behavior is for
local demonstration and testing only; do not expose the API as a secured
multi-user service. JSON errors use
`{ "error": "short_code", "message": "..." }`.

## Collections

| Resource | Collection route | Request fields | Response fields |
| --- | --- | --- | --- |
| Guidelines | `/api/guidelines` | `title`, `description`, optional `category` | `id`, `title`, `description`, `category` |
| Glossary terms | `/api/glossary` | `term`, `definition`, optional `preferredTerm`, `status`, `guidelineId` | `id`, `term`, `definition`, nullable `preferredTerm`, `status`, nullable `guidelineId` |
| Facts | `/api/facts` | `claim`, `owner`, `reviewDate` (`YYYY-MM-DD`), optional `source`, `lastReviewed` | `id`, `claim`, `owner`, nullable `reviewDate`, `source`, nullable `lastReviewed`, `outdated` |
| Assets | `/api/assets` | `name`, `description`, optional `url`, `assetType` | `id`, `name`, `description`, nullable `url`, `assetType` |

Each item returned by the API includes an `id`.

- `GET /api/{collection}` returns the collection.
- `POST /api/{collection}` creates an item and returns it with status `201`.
- `PUT /api/{collection}/{id}` replaces an item and returns the updated item.
- `DELETE /api/{collection}/{id}` removes an item and returns status `204`.
- `POST /api/seed/load` loads the fictional brand from `seed/brand.json`.
  It adds missing sample records by stable natural keys, does not overwrite or
  delete existing records, and is restricted to Admin and Brand Manager roles.
- `PUT /api/facts/{id}/re-approve` is the dedicated evidence-renewal action
  (restricted to Admin and Brand Manager; Creator and Reviewer roles receive
  `403`). The body is `{ "reviewDate": "YYYY-MM-DD", "lastReviewed":
  "YYYY-MM-DD"? }`; `reviewDate` is required and must be today's date or later
  — a past date is a caller mistake and returns `422` without changing the
  fact. When `lastReviewed` is omitted it defaults to today. The response is
  the fact record with its updated dates: an expired fact (`outdated: true`)
  stops being flagged and starts presenting current evidence the moment the
  new expiry wraps it. Unknown facts return `404` with
  `{ "error": "not_found", "message": "Fact not found." }`. Re-approval
  records a `knowledge_fact_reapproved` audit event in the same transaction,
  distinct from the `knowledge_fact_updated` event an ordinary wording edit
  produces on `PUT /api/facts/{id}`.
- `GET /api/health` returns `{ "status": "ok" }`.

These collection and seed routes query or modify SQLAlchemy records in the
configured database. Successful guideline, term, fact, and asset creates,
updates, and deletes also create workspace-level audit events in the same
transaction. The seed endpoint records each load as a separate audit event.

## Content

Content records are persisted in the configured SQLAlchemy database.
`X-Role`/`X-User` provide simulated demo role and actor context; they are
caller-controlled and are not an identity or security boundary. Creator reads
and writes are restricted to records whose `created_by` matches the demo actor
name after removing its displayed role suffix.

- `GET /api/content` lists content. Creators receive only their own items;
  Reviewer, Brand Manager, and Admin can inspect all items. An optional
  `status` query parameter filters by exact status.
- `POST /api/content` accepts `title`, `content_type`, and `body`, creates a
  separate draft with version `1`, and returns `201` with its database `id`,
  initial status, version, owner, and timestamps. Only Creators may create.
  `body` may be empty for a new draft; the editor shows its own placeholder
  until text is entered.
- `GET /api/content/{id}` returns the persisted content record.
- `PUT /api/content/{id}` accepts `title`, `content_type`, `body`, and the
  expected `version`. Only the owning Creator may update a draft. A successful
  change increments the version, clears the reviewed-version marker, and
  writes an audit event. A stale expected version returns `409`.
- `DELETE /api/content/{id}` removes a draft. Only the owning Creator may
  delete a draft; other statuses return `403`. It returns status `204` and
  writes an audit event that survives the deletion.
- `GET /api/content/{id}/findings` returns persisted findings and content and
  reviewed versions.
- `GET /api/content/{id}/audit` returns audit events for one item.
- `GET /api/audit` returns the actor's permitted audit events; Creators see
  only events for their own content.
- `GET /api/content/{id}/images` returns images attached to the content,
  including `filename`, `mime_type`, `alt_text`, and a `url` for the preview.
- `POST /api/content/{id}/images` accepts a multipart `file`. Only PNG, JPEG,
  and WebP files up to 5 MB are accepted. Only the owning Creator can upload
  images to a draft.
- `PATCH /api/content-images/{image_id}` accepts `{ "alt_text": "..." }`.
  Only the owning Creator can update alt text on a draft. Empty alt text is
  retained so the editor can report the accessibility warning.
- `GET /api/images/{image_id}/file` serves a stored content image for preview.
  The demo stores files under the backend's local `uploads/` directory; use
  object storage or a persistent volume for production deployments.

Content includes `content_type` (for example `marketing_copy`, `blog_post`,
`social_media`, `email`, or `other`), status, version, `reviewed_version`, and
`reviewed_at`. Existing installations add the new nullable review markers and
content type with the startup schema migration.

## Content review

`POST /api/content/{id}/review` is restricted to the owning Creator and only
accepts drafts. It returns `200` with the content version, persisted findings,
and engine statuses. The record's `reviewed_version` and `reviewed_at` are
updated atomically with findings and a `content_reviewed` audit event, even if
the review produces no findings. A content edit or finding correction clears
the review marker for the new version. Each finding contains an integer
`id`, string `check`, `severity`, `message`, and `status`, an `evidence`
object, a nullable string `suggested_fix`, and nullable integer `start_offset`
and `end_offset`. The evidence object contains string `matched_text`, object
`source`, boolean `requires_manual_review`, and an optional object
`suggestion_source`. Findings are returned in ascending text-position order.
Each persisted finding is associated with the requested content ID and the
content version reviewed.

```json
{
  "content_id": 1,
  "content_version": 1,
  "findings": [
    {
      "id": 1,
      "check": "terminology",
      "severity": "warning",
      "message": "Prohibited term detected: example",
      "evidence": {
        "matched_text": "example",
        "source": {},
        "requires_manual_review": false
      },
      "suggested_fix": "preferred wording",
      "start_offset": 12,
      "end_offset": 19,
      "status": "open"
    }
  ],
  "engine": { "rules": "ok", "llm": "ok" }
}
```

Missing content returns `404` with
`{ "error": "not_found", "message": "Content not found." }`. Invalid path
input returns `422` with
`{ "error": "validation_error", "message": "The request data is invalid." }`.
Database failures return `500` with
`{ "error": "review_failed", "message": "Unable to save review findings." }`.

Review also evaluates the images attached to the content. Every image whose
alt text is missing or whitespace-only produces an `accessibility` finding
with severity `warning` — it does not block self-check. The message names the
file (for example `Image 'banner.png' is missing alt text.`), the finding has
no text offsets, its evidence carries `source.type "image"` with the image ID
and filename, and `suggested_fix` is populated (so
`requires_manual_review` is `false`) recommending that descriptive alt text
be added through the image panel. An attached image whose alt text has been
filled (via `PATCH /api/content-images/{id}`) produces no accessibility
findings on a re-review. Image uploads
themselves already reject unsupported formats with `422` (`validation_error`)
and files larger than 5 MB with `413` (`file_too_large`).

### Finding actions

`PATCH /api/findings/{id}` accepts an action for an open finding. The frontend
must send `X-User`; only the owning Creator may resolve findings on a draft.
That value is recorded as the audit actor.

Accept an existing suggestion or dismiss a finding:

```json
{ "action": "accept" }
```

```json
{ "action": "dismiss" }
```

For a custom correction, `replacement` is required and must not be blank:

```json
{ "action": "edit", "replacement": "preferred wording" }
```

The `replacement` field is not allowed with `accept` or `dismiss`. Accept
applies the finding's `suggested_fix`; if there is no suggestion, the request
conflicts. Accept and edit replace only the span indicated by the finding's
offsets and increment the content version once when the replacement changes
the content. A replacement identical to the matched text resolves the finding
and records the action without changing the content version. Other findings
are advanced to the new version only when their stored spans can be verified
against the updated text; findings without verifiable spans remain associated
with their older version and are stale. If the target span is stale or overlaps
another finding, the action is rejected rather than risking an incorrect edit.
Dismiss does not change the content or its version. Successful actions return
`200`:

```json
{
  "content_id": 1,
  "content_version": 2,
  "finding": {
    "id": 1,
    "check": "terminology",
    "severity": "warning",
    "message": "Prohibited term detected: example",
    "evidence": {
      "matched_text": "example",
      "source": {},
      "requires_manual_review": false
    },
    "suggested_fix": "preferred wording",
    "start_offset": 12,
    "end_offset": 28,
    "status": "accepted"
  }
}
```

The finding uses the same fields and types as a finding in the review response.
Each successful action records an `AuditEvent` with action `finding_accepted`,
`finding_edited`, or `finding_dismissed`; its details include the finding ID and
previous/new content versions. Text changes additionally include previous and
replacement text.

Missing findings return `404` with
`{ "error": "not_found", "message": "Finding not found." }`. Invalid action or
replacement fields return `422` with
`{ "error": "validation_error", "message": "The request data is invalid." }`.
Resolved findings, stale offsets or versions, missing suggestions, and
overlapping finding spans return `409` with a JSON `{ "error": "...",
"message": "..." }` body. Database failures return `500` with
`{ "error": "review_failed", "message": "Unable to save finding action." }`.
Content, finding, version, and audit changes are committed atomically.

The LLM status is `disabled` when `LLM_API_KEY` is not configured, `timeout`
when the request exceeds `LLM_TIMEOUT_SECONDS`, `error` for other provider or
response-validation failures, and `ok` when guideline review succeeds.
Rule-based terminology and claim checks continue when the LLM is unavailable.

The standalone mock service in `frontend/mock_kb.mjs` implements these routes and
persists data to `frontend/mock-kb-data.json` by default. Its integration check
uses a temporary database and does not alter the developer's saved mock data.

## Content approval workflow

Content status transitions follow this sequence:
`draft → self_checked → in_review → approved → ready_to_publish`.
The shared backend transition service authorizes `creator` for
`draft → self_checked` and `self_checked → in_review`, `reviewer` for
`in_review → approved`, and `brand_manager` or `admin` for
`approved → ready_to_publish`. Callers must obtain the role through the
existing `X-Role` role dependency and provide the actor from `X-User`.

`POST /api/content/{id}/self-check` exposes the first transition. It is
restricted to the owning Creator and only succeeds when the current content
version has a persisted backend review and no open high-severity findings.
Missing or stale review data and unresolved blockers return `409`; they do not
change the status.

`POST /api/content/{id}/submit` accepts an empty request body and submits
content for review. Only a creator can submit content in `self_checked` status.
On success it returns `200`:

```json
{
  "content_id": 1,
  "status": "in_review",
  "content_version": 2
}
```

Submission does not change the content text or version. It returns `404` with
`{ "error": "not_found", "message": "Content not found." }` when the content
does not exist, and `403` with the existing `forbidden` error shape when the
role is missing, invalid, or not `creator`. The request requires the existing
`X-User` demo actor header; a missing actor header returns `422` with the
standard `validation_error` response.

Invalid transitions return `409` with
`{ "error": "invalid_status_transition", "message": "Status transition is not allowed." }`.
Submission is blocked with `409` if an open, high-severity finding exists for
the current content version or a resolved finding's flagged text still remains
in the content:
`{ "error": "open_high_severity_findings", "message": "Content cannot be submitted while high-severity findings remain unresolved." }`.
Database failures return `500` with
`{ "error": "workflow_failed", "message": "Unable to submit content for review." }`.

The status transition and its `AuditEvent` are committed atomically. The event
uses action `content_status_changed`, the actor and content ID fields, a
database timestamp, and details containing `actor_role`, `previous_status`,
and `new_status`.

`POST /api/content/{id}/decision` accepts a review decision:

```json
{
  "decision": "request_changes",
  "comment": "Please clarify the supporting claim."
}
```

`decision` must be `approve` or `request_changes`. `comment` is optional for
approval and required, non-empty after trimming, for a request for changes.
When supplied, a comment is saved to the existing content comments collection
with the reviewer as its author. Only a reviewer may decide content while it
is `in_review`: approval transitions it to `approved`, and requesting changes
returns it to `draft`. Decisions do not change the content text or version.

Successful requests return `200` with the resulting content status and the
persisted comment when one was supplied:

```json
{
  "content_id": 1,
  "status": "draft",
  "content_version": 2,
  "comment": {
    "id": 1,
    "author": "reviewer-user",
    "body": "Please clarify the supporting claim.",
    "created_at": "2026-10-26T16:33:00Z"
  }
}
```

For approval without a comment, `comment` is `null`. A missing, invalid, or
non-reviewer role returns `403` with the existing `forbidden` response. A
missing `X-User` header returns `422` with the standard `validation_error`
response. Missing content returns `404` with
`{ "error": "not_found", "message": "Content not found." }`. Invalid decisions,
unknown request fields, and a missing or blank required comment return `422`
with `{ "error": "validation_error", "message": "The request data is invalid." }`.
An invalid status transition returns `409` with
`{ "error": "invalid_status_transition", "message": "Status transition is not allowed." }`.
Database failures return `500` with
`{ "error": "workflow_failed", "message": "Unable to save review decision." }`.
The status change, optional comment, and `content_status_changed` audit event
are committed atomically; the event records the actor, content ID, role,
previous status, and new status.

`POST /api/content/{id}/ready-to-publish` accepts an empty request body and
transitions content from `approved` to `ready_to_publish`. Only a
`brand_manager` or `admin` may perform this transition. It returns `200` with
the same `{ "content_id", "status", "content_version" }` response as submit.
The content text and version are unchanged. Missing content returns `404`;
missing or unauthorized roles return `403`; missing `X-User` returns `422`.
Invalid transitions return `409` with
`{ "error": "invalid_status_transition", "message": "Status transition is not allowed." }`.
Database failures return `500` with
`{ "error": "workflow_failed", "message": "Unable to update content status." }`.
The shared transition service writes exactly one `content_status_changed`
audit event with the transition and actor details in the same transaction.

Standalone review comments use the existing content comments collection.
`POST /api/content/{id}/comments` accepts:

```json
{ "body": "Please clarify the supporting claim." }
```

The body must be non-empty after trimming and unknown request fields are
rejected. Only a reviewer may add a comment while the content is `in_review`.
The existing `X-Role` dependency validates the simulated role and `X-User`
supplies the demo comment author. Success returns `201` with the comment schema:

```json
{
  "id": 1,
  "author": "reviewer-user",
  "body": "Please clarify the supporting claim.",
  "created_at": "2026-10-26T16:33:00Z"
}
```

Comment creation also writes a `comment_added` audit event transactionally.
Missing content returns `404`; invalid role or a content status other than
`in_review` returns `403`; missing actor or invalid comment data returns `422`.
Database failures return `500` with
`{ "error": "workflow_failed", "message": "Unable to save review comment." }`.

`GET /api/content/{id}/comments` returns
`{ "content_id": 1, "comments": [<comment schema>, ...] }`, ordered by
creation time and comment ID. The content creator may retrieve comments on
their own content; reviewers, brand managers, and admins may retrieve comments
for any content. Other roles or creators who do not own the content receive
`403`. Missing content returns `404`; missing or invalid roles return `403`;
missing `X-User` returns `422`. Database failures return `500` with
`{ "error": "workflow_failed", "message": "Unable to load review comments." }`.
Comments attached to a `request_changes` decision are included in this
collection and use the same authorization rules.

## Evidence requests

Evidence requests track work to find proof for claims that the review flagged
as `unsupported_claim`. Any valid demo role (`admin`, `brand_manager`,
`creator`, `reviewer`) may create and retrieve them through the standard
`X-Role` header.

- `POST /api/evidence-requests` accepts `claimText` (the claim text from the
  finding), `findingId` (integer ID of an existing finding whose `check_type`
  is `unsupported_claim`), `reason`, and `assignee` (one of the configured
  demo owners: `Asha (Creator)`, `Ravi (Reviewer)`, `Bhavana (Brand Manager)`,
  or `Admin`). When a finding includes matched claim text, `claimText` must
  match it. Leading and trailing whitespace is trimmed; blank required fields
  are rejected. It returns `201` with the created
  request:

```json
{
  "id": 1,
  "claimText": "Blocks ads for a wide audience.",
  "findingId": 12,
  "reason": "Need approval proof from the brand team before publishing.",
  "assignee": "Ravi (Reviewer)",
  "status": "open",
  "createdAt": "2026-11-01T12:00:00",
  "updatedAt": "2026-11-01T12:00:00"
}
```

- `GET /api/evidence-requests` returns all requests ordered by ascending ID.
  Optional query filters: `status` (one of `open`, `fulfilled`, `dismissed`),
  `assignee` (exact match), and `findingId`. The filters combine.

Error cases: an unknown `findingId` returns `404` with
`{ "error": "not_found", "message": "Finding not found." }`; a finding whose
`check_type` is not `unsupported_claim` returns `422` naming the check;
missing or blank fields return `422` with
`{ "error": "validation_error", "message": "..." }`; a `status` filter outside
the enum returns `422`. Each successful create records an audit event with
action `evidence_request_created` in the same transaction; its details include
the finding ID, assignee, actor role, and the new request ID.

### Attaching evidence

Any valid demo role attaches the owner's proof with
`POST /api/evidence-requests/{id}/evidence`. The body has `sourceType`
(`"url"` or `"document"`) plus the fields that belong to that source kind:

```json
{ "sourceType": "url", "sourceUrl": "https://luminahome.com/report" }
```

```json
{ "sourceType": "document", "documentName": "Brand-safety-guidelines",
  "documentType": "pdf" }
```

`sourceUrl` must be a valid `http(s)` URL; `documentType` must be one of
`pdf`, `doc`, `docx`, `xls`, `xlsx`, `ppt`, `pptx`, `png`, `jpg`, `jpeg`,
`webp`; `documentName` is required for a document source. Fields of the other
source kind must be absent: a URL source attached alongside `documentName` or
`documentType`, or a document source attached alongside `sourceUrl`, returns
`422`. Blank or malformed values return `422` with
`{ "error": "validation_error" }`; an unknown request returns `404` with
`{ "error": "not_found", "message": "Evidence request not found" }`.

Attaching does not close the request: `status` remains `open`. Re-attaching
overwrites the single evidence slot; every attach overwrites the response
fields `sourceType`, `sourceUrl`, `documentName`, `documentType`, `attachedBy`
(role), and `attachedAt`, and records an `evidence_request_attached` audit
event in the same transaction. The response itself contains all evidence and
verification fields.

### Reviewer verification

`POST /api/evidence-requests/{id}/verify` is restricted to the `reviewer`
role; other roles receive `403` with `{ "error": "forbidden" }`. A verify on
an open request that has attached evidence sets the request `status` to
`fulfilled` and stamps `verifiedBy` (the role) and `verifiedAt`, returning the
updated request. Verify attempts return `409` with
`{ "error": "conflict" }` when the request is not open (already fulfilled or
dismissed) or has no attached evidence yet. Verification records an
`evidence_request_verified` audit event with the request ID and source type in
the same transaction. No other status transitions exist through this API.

### Evidence review decisions and activity

`GET /api/evidence-requests/{id}` returns the request, submitted evidence,
owner explanation, and any final reviewer decision. Evidence submission also
accepts `evidenceDescription` and optional `ownerExplanation`; a creator may
submit only when `X-User` identifies the assigned owner. Reviewer, brand
manager, and admin roles may inspect submissions.

- `POST /api/evidence-requests/{id}/approve` accepts `{ "feedback": "..." }`
  and is restricted to authorised reviewer roles. It stores reviewer feedback
  and a decision timestamp, sets `decision` to `approved`, and changes the
  request status to `fulfilled`.
- `POST /api/evidence-requests/{id}/reject` has the same body and permissions,
  but requires feedback explaining the rejection. It stores `decision` as
  `rejected` and changes the request status to `dismissed`.
- A final decision cannot be overwritten. Both endpoints require submitted
  evidence and return `409` for invalid transitions.
- `GET /api/evidence-requests/{id}/activity` returns chronological activity
  entries for creation, evidence submission, verification, approval, and
  rejection. Entries are backed by the existing `audit_events` table.

## Frontend integration and demo role context

The Write & Review editor, review queue, and audit trail call these backend
routes through the shared frontend API client. They load content by its real
database ID and refresh content, findings, comments, and audit events after
successful mutations. They do not use browser-local mock data as a fallback;
network and HTTP failures are surfaced with retry controls.

The API simulates the four workflow roles and content ownership using
`X-Role`/`X-User`. These headers can be impersonated and provide no production
authentication or security. Keep this implementation limited to local
demonstration and testing. `seed/brand.json` and the sample brand action remain
intentional fictional demonstration data; content workflows use database
records.
