# Frontend

Next.js (App Router, TypeScript). Owner: Akshatha.

## Run locally

```
cd frontend
cp .env .env.local
npm install
npm run dev          # http://localhost:3000
```

## What is here

- `src/components/TopBar.tsx`: CoRESpace sidebar navigation and role switcher
- `src/components/editor/Editor.tsx`: Write & Review form and local demonstration review
- `src/components/editor/HighlightedDraft.tsx`: severity-coded sample phrase highlights linked to finding cards
- `src/components/editor/FindingsPanel.tsx` and `FindingCard.tsx`: review summary, fact-source details, and local finding controls
- `src/lib/mock-findings.ts`: deterministic demo checks for the fictional sample draft, resolved against current mock knowledge records
- `src/lib/mock-data.ts`: shared in-memory knowledge, document, queue, findings, and review-history state for the demonstration
- `src/app/page.tsx`, `src/app/queue/page.tsx`, and `src/app/audit/page.tsx`: demonstration dashboard statistics, review queue, and history based on that shared state
- `src/app/knowledge/page.tsx`: editable Guidelines, Glossary, Facts and Assets tabs under the single Guidelines navigation item
- `src/lib/brand-data.ts`: API-shaped knowledge types and shared sample records mapped from fixtures in `mocks/`
- `mock_kb.mjs`: persistent local stand-in for the knowledge API
- `src/components/RoleSwitcher.tsx`: demo role switcher, no login
- `src/lib/api.ts`: the only place that calls the backend. Reads `NEXT_PUBLIC_API_URL` and sends `X-Role` and `X-User` on every request
- `src/lib/roles.ts`: the four roles and the display name sent as `X-User`
- `src/lib/types.ts`: types copied from `docs/API_CONTRACT.md`
- `src/components/BackendStatus.tsx`: home-page check that the backend is reachable

Write & Review, the dashboard, queue, and history use shared local demonstration
data from the fixtures in `mocks/`. A sample review updates the document
timestamp, findings, dashboard counts, and history together for the current
app session. Shared mock changes, including accepted/edited/dismissed findings
and document text, are stored in this browser's `localStorage` and restored on
reload. This is browser-local demonstration persistence, not server persistence;
clearing this site's browser storage removes it. Findings are only shown for the exact
fictional sample draft.
Pasted content does not receive generated or verified results. Finding actions
and knowledge edits remain mock data. Finding sources, fact claims, people and
dates are fictional demonstration data, not verified citations or facts. The
content type selector currently offers Marketing Copy only.

Call the backend like this:

```ts
import { api } from "@/lib/api";
import type { Content } from "@/lib/types";

const content = await api.get<Content>("/api/content/1");
await api.post("/api/content/1/submit");
```

Errors are thrown as `ApiError` with `status`, `code` and a readable `message`.

Use **Load sample brand** on the home screen or in the Guidelines page to reset
the shared in-memory mock knowledge records.

The knowledge editor and Write & Review currently use local mock data only;
they do not fall back to mock data after an API error. The API layer and optional
mock knowledge server remain available for separate integration work.

To run the standalone mock knowledge API checks:

```
npm run mock:kb
npm run dev
```

The API defaults to `http://localhost:8000`, matching `NEXT_PUBLIC_API_URL`.
Run `npm run test:kb` to check collection CRUD, sample loading, reload reads, and
persistence across a mock-server restart.

## Deploy (Vercel)

1. Push the repo to GitHub, then in Vercel choose **Add New → Project** and import it.
2. Set **Root Directory** to `frontend`. The framework is detected as Next.js.
3. Add the environment variable `NEXT_PUBLIC_API_URL` = the public **https** URL of the backend (no trailing slash). Until the backend is deployed, leave it unset; the home page will show "Server not reachable".
4. Deploy. When the backend URL is ready, set the variable and **redeploy**, because the value is baked in at build time.
5. On the backend, allow the frontend origin in `CORS_ORIGINS` and allow the `X-Role` and `X-User` request headers.
6. Open the production URL in a private window. If it asks you to sign in to Vercel, turn off Deployment Protection for the project (Settings → Deployment Protection).

## Checks before you call issue #2 done

- [ ] The production URL opens in a private window without any sign-in
- [ ] Top bar, navigation and role switcher are visible at phone width (about 390px) and laptop width (1280px)
- [ ] No sideways scrolling on the page at phone width (the navigation row may scroll on its own)
- [ ] In the browser Network tab, a request to `/api/health` carries `X-Role` and `X-User`
