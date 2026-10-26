# Knowledge base API

The frontend sends `X-Role` and `X-User` on every request. Resource identifiers
are strings. JSON errors use `{ "error": "short_code", "message": "..." }`.

## Collections

| Resource | Collection route | Fields |
| --- | --- | --- |
| Guidelines | `/api/guidelines` | `title`, `description` |
| Glossary terms | `/api/glossary` | `term`, `definition`, `preferredTerm` |
| Facts | `/api/facts` | `claim`, `owner`, `reviewDate` (`YYYY-MM-DD`) |
| Assets | `/api/assets` | `name`, `description`, optional `url` |

Each item returned by the API includes an `id`.

- `GET /api/{collection}` returns the collection.
- `POST /api/{collection}` creates an item and returns it with status `201`.
- `PUT /api/{collection}/{id}` replaces an item and returns the updated item.
- `DELETE /api/{collection}/{id}` removes an item and returns status `204`.
- `POST /api/brand/sample` replaces the current knowledge base with the supplied
  `{ guidelines, glossary, facts, assets }` sample payload.
- `GET /api/health` returns `{ "status": "ok" }`.

## Content review

`POST /api/content/{id}/review` returns `200` with the content version,
persisted findings, and engine statuses. Each finding contains an integer
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

### Finding actions

`PATCH /api/findings/{id}` accepts an action for an open finding. The frontend
must send `X-User`; that value is recorded as the audit actor.

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
`X-User` actor header; a missing actor header returns `422` with the standard
`validation_error` response. The current backend dependency validates role
headers but does not provide a separate identity-authentication mechanism.

Invalid transitions return `409` with
`{ "error": "invalid_status_transition", "message": "Status transition is not allowed." }`.
Submission is blocked with `409` if an open, high-severity finding exists for
the current content version:
`{ "error": "open_high_severity_findings", "message": "Content cannot be submitted while high-severity findings remain open." }`.
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

## Frontend workflow prototype

The current frontend includes a browser-local workflow demonstration. Its
content states are `draft`, `in_review`, `changes_requested`, and
`ready_to_publish`; `approved` is retained as a valid API-shaped status but the
mock reviewer approval transitions directly to `ready_to_publish` after
required checks pass. Creator submission requires a current demonstration
review and no unresolved high-severity findings. A dismissed high-severity
finding remains blocking while its flagged text is still present. Only the
Reviewer demo role can approve or request changes; the role switcher is not
authentication.

Review records, comments, decisions, prior submitted versions, and workflow
audit events are stored in browser `localStorage`. They are not sent to the
backend, do not represent verified checks, and do not publish content. The
backend review, submit, and decision routes are defined above. Standalone
comment and other status transitions do not have dedicated backend endpoints.

The frontend audit timeline uses the shared workflow history collection. Each
event is associated with a content ID and stores the demo actor name and role
at action time, ISO 8601 timestamp, action type, and available finding,
comment, or previous/new-value details. Events are displayed oldest first;
events sharing a timestamp are ordered by their stable numeric event ID.
Finding decisions, draft edits/resets, mock review runs, submissions and
resubmissions, comments, requested changes, approval, and Ready to publish
transitions are recorded only after the corresponding local mock operation
succeeds. This browser-local history is not authenticated, tamper-proof, or
server-persistent. A future backend integration should provide a durable
content-scoped audit API and server-verified actor identity rather than relying
on the demo role selector.
