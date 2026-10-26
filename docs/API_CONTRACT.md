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
offsets and increment the content version once. Other findings are advanced
to the new version only when their stored spans can be verified against the
updated text; findings without verifiable spans remain associated with their
older version and are stale. If the target span is stale or overlaps another
finding, the action is rejected rather than risking an incorrect edit.
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

## Frontend workflow prototype (not a backend API)

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
backend, do not represent
verified checks, and do not publish content. Only the backend review route
above is defined for content review. The frontend submission, decision,
comment, and audit workflows remain local demonstrations and have no backend
endpoints in this contract.

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
