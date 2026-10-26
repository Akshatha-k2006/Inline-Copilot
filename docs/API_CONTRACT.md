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

The standalone mock service in `frontend/mock_kb.mjs` implements these routes and
persists data to `frontend/mock-kb-data.json` by default. Its integration check
uses a temporary database and does not alter the developer's saved mock data.