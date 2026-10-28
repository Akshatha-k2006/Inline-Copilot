# Frontend

Next.js (App Router, TypeScript). Owner: Akshatha.

## Run locally

```
cd frontend
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

## What is here

- `src/components/TopBar.tsx`: CoRESpace sidebar navigation and role switcher
- `src/components/editor/Editor.tsx`: Write & Review form and local demonstration review
- `src/components/editor/HighlightedDraft.tsx`: severity-coded sample phrase highlights linked to finding cards
- `src/components/editor/FindingsPanel.tsx` and `FindingCard.tsx`: review summary, fact-source details, and local finding controls
- `src/lib/mock-findings.ts`: deterministic demo checks for the fictional sample draft, resolved against current mock knowledge records
- `src/lib/mock-data.ts`: shared localStorage-backed demonstration knowledge, document, finding, review, comment, and audit state
- `src/lib/workflow.ts`: centralized mock workflow permissions, review validity, status labels, and submission blockers
- `src/app/page.tsx`, `src/app/queue/page.tsx`, and `src/app/audit/page.tsx`: demonstration dashboard statistics, review queue, and history based on that shared state
- `src/app/knowledge/page.tsx`: backend-backed Guidelines, Glossary, Facts and Assets tabs under the single Guidelines navigation item
- `src/lib/brand-data.ts`: knowledge display types and fictional local demonstration records
- `mock_kb.mjs`: persistent local stand-in for the knowledge API
- `src/components/RoleSwitcher.tsx`: demo role switcher, no login
- `src/lib/api.ts`: centralized backend client. Reads `NEXT_PUBLIC_API_BASE_URL` and sends `X-Role` and `X-User` on every request
- `src/lib/roles.ts`: the four roles and the display name sent as `X-User`
- `src/lib/types.ts`: types copied from `docs/API_CONTRACT.md`

Write & Review, dashboard, queue, and history use one shared local demonstration
workspace. Workflow actions, knowledge changes, comments, findings and audit
entries persist in this browser's `localStorage`; this is not server persistence.
These mock knowledge records are separate from the backend-backed Knowledge
page. The knowledge page and sample-brand action use the configured backend
API. The backend role header is a demo role selector, not authentication.
Clearing this site's browser storage removes saved demo state.
Audit Trail filters events by content and presents them oldest first, using the
stable event ID to order events with the same timestamp. It records the demo
actor and role selected when each successful mock action occurred; these are
not authenticated or tamper-proof identities.

The demo role switcher is not authentication. Creator Asha can edit the sample
draft, run fixed known-phrase checks, resolve findings and submit eligible
content. Only Reviewer Ravi can comment, approve, or request changes. Brand
Manager and Admin can inspect review information; Brand Manager and Admin can
manage knowledge, but neither bypasses reviewer decisions. The mock lifecycle
is Draft → In Review → Changes Requested → In Review → Ready to publish.
Approval requires a current mock review and no unresolved high-severity issue.
A dismissed high-severity finding still blocks submission if its text remains.
Resubmissions retain prior submitted snapshots for reviewer comparison. The
prototype does not publish content.

The dashboard's getting-started guide follows the five numbered steps in the
repository README. Dismissing it stores a browser-local preference under
`corespace-getting-started-dismissed-v1`; use **Show getting-started guide** on
the dashboard to reopen it. The preference is not account- or server-synced.

Demo checks only match known fixture phrases and current mock knowledge; they do
not comprehensively verify arbitrary text. Source references, facts, owners,
dates, reviewers and workflow outcomes are demonstration data, not verified
evidence. Changes Requested comments and decisions are stored as mock records.
The backend implements review and workflow endpoints, but the current editor,
review queue and audit page do not call them. Content list/read/create/update
and audit-history endpoints are missing, so those pages remain explicitly
browser-local demonstrations rather than displaying persisted backend records.
Write & Review, the dashboard, queue, and history use shared local demonstration
data from the fixtures in `mocks/`. A sample review updates the document
timestamp, findings, dashboard counts, and history together for the current
app session. Shared mock changes, including accepted/edited/dismissed findings
and document text, are stored in this browser's `localStorage` and restored on
reload. This is browser-local demonstration persistence, not server persistence;
clearing this site's browser storage removes it. Findings are only shown for the exact
fictional sample draft.
Pasted content does not receive generated or verified results. Finding actions
remain mock data. Finding sources, fact claims, people and dates in the editor
are fictional demonstration data, not verified citations or facts. The content
type selector currently offers Marketing Copy only.

Call an implemented backend endpoint like this:

```ts
import { api } from "@/lib/api";

const guidelines = await api.listGuidelines();
await api.createGuideline({ title: "Voice", description: "Use clear language." });
```

Errors are thrown as `ApiError` with `status`, `code` and a readable `message`.

**Load sample brand** calls `POST /api/seed/load`; it resets backend knowledge
records and sample content ID `1`. It is restricted to Admin and Brand Manager.

The knowledge page does not fall back to fixtures if the API fails. Write &
Review, the dashboard, queue, and audit page continue to use local mock data.

To run the standalone mock knowledge API checks:

```
npm run mock:kb
npm run dev
```

The API defaults to `http://localhost:8000`, matching `NEXT_PUBLIC_API_BASE_URL`.
Run `npm run test:kb` to check collection CRUD, sample loading, reload reads, and
persistence across a mock-server restart.
Run `npm run test:mock` to validate fixture IDs, finding citations, knowledge
references, audit timestamps, and content relationships.

## Deploy (Vercel)

1. Push the repo to GitHub, then in Vercel choose **Add New → Project** and import it.
2. Set **Root Directory** to `frontend`. The framework is detected as Next.js.
3. Add the environment variable `NEXT_PUBLIC_API_BASE_URL` = the public **https** URL of the backend (no trailing slash). The value is public and is baked in at build time.
4. Deploy. When the backend URL is ready, set the variable and **redeploy**, because the value is baked in at build time.
5. On the backend, allow the frontend origin in `CORS_ORIGINS` and allow the `X-Role` and `X-User` request headers.
6. Open the production URL in a private window. If it asks you to sign in to Vercel, turn off Deployment Protection for the project (Settings → Deployment Protection).

## Checks before you call issue #2 done

- [ ] The production URL opens in a private window without any sign-in
- [ ] Top bar, navigation and role switcher are visible at phone width (about 390px) and laptop width (1280px)
- [ ] No sideways scrolling on the page at phone width (the navigation row may scroll on its own)
- [ ] In the browser Network tab, a request to `/api/health` carries `X-Role` and `X-User`
