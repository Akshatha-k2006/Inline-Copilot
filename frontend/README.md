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

- `src/components/TopBar.tsx`: app name, navigation (Knowledge base, Editor, Review queue, Audit), role switcher
- `src/components/RoleSwitcher.tsx`: demo role switcher, no login
- `src/lib/api.ts`: the only place that calls the backend. Reads `NEXT_PUBLIC_API_URL` and sends `X-Role` and `X-User` on every request
- `src/lib/roles.ts`: the four roles and the display name sent as `X-User`
- `src/lib/types.ts`: types copied from `docs/API_CONTRACT.md`
- `src/components/BackendStatus.tsx`: home-page check that the backend is reachable

Call the backend like this:

```ts
import { api } from "@/lib/api";
import type { Content } from "@/lib/types";

const content = await api.get<Content>("/api/content/1");
await api.post("/api/content/1/submit");
```

Errors are thrown as `ApiError` with `status`, `code` and a readable `message`.

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
