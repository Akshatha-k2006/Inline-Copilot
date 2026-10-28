# Frontend

Next.js (App Router, TypeScript). Owner: Akshatha.

## Run locally

```
cd frontend
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3000
```

## Backend integration

- `src/lib/api.ts` is the canonical API client. It reads
  `NEXT_PUBLIC_API_BASE_URL` and sends `X-Role` and `X-User` on requests.
- The Dashboard loads health, backend knowledge collections, and persisted
  content. It does not replace failed API requests with fixture data.
- Write & Review creates and updates persisted content and uses backend review,
  findings, comments, audit, and workflow endpoints.
- The role switcher selects a prototype role; these headers are not
  authentication.
- Local fixture modules support sample presentation only; they are not used as
  a fallback when a backend request fails.

Call an implemented backend endpoint like this:

```ts
import { api } from "@/lib/api";

const guidelines = await api.listGuidelines();
await api.createGuideline({ title: "Voice", description: "Use clear language." });
```

Errors are thrown as `ApiError` with `status`, `code` and a readable `message`.

**Load sample brand** calls `POST /api/seed/load`; it resets backend knowledge
records and sample content ID `1`. It is restricted to Admin and Brand Manager.

In development, the API defaults to `http://localhost:8000`. In production,
`NEXT_PUBLIC_API_BASE_URL` is required; the application does not silently send
production traffic to the visitor's localhost.
Run `npm run test:kb` to check collection CRUD, sample loading, reload reads, and
persistence across a mock-server restart.
Run `npm run test:mock` to validate fixture IDs, finding citations, knowledge
references, audit timestamps, and content relationships.

## Deploy (Vercel)

1. Push the repo to GitHub, then in Vercel choose **Add New → Project** and import it.
2. Set **Root Directory** to `frontend`. The framework is detected as Next.js.
3. Add `NEXT_PUBLIC_API_BASE_URL` as the public **https** base URL of the deployed backend (no trailing slash). This is a public value, not a secret, and is baked in at build time.
4. On the backend, add the exact production frontend origin to `CORS_ORIGINS` (comma-separated with `http://localhost:3000` for local development). The backend permits the required `X-Role` and `X-User` headers.
5. Redeploy the frontend after changing its environment variable. Configure the backend database and other private settings on the backend host only; never put credentials in `NEXT_PUBLIC_*` variables.
6. Open the production URL in a private window. If it asks you to sign in to Vercel, turn off Deployment Protection for the project (Settings → Deployment Protection).

## Checks before you call issue #2 done

- [ ] The production URL opens in a private window without any sign-in
- [ ] Top bar, navigation and role switcher are visible at phone width (about 390px) and laptop width (1280px)
- [ ] No sideways scrolling on the page at phone width (the navigation row may scroll on its own)
- [ ] In the browser Network tab, a request to `/api/health` carries `X-Role` and `X-User`
