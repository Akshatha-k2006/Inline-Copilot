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

`POST /api/content/{id}/review` returns the content version, persisted
findings, and engine statuses:

```json
{
  "content_id": 1,
  "content_version": 1,
  "findings": [],
  "engine": { "rules": "ok", "llm": "ok" }
}
```

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
verified checks, and do not publish content. No content-review workflow
endpoints are defined by this contract yet.