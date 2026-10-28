# Inline-Copilot

An AI-powered brand governance platform that reviews content against approved brand guidelines, verifies claims against approved facts, and provides evidence-backed suggestions before publication. Features a Governance Hub for content review, approvals, and brand consistency insights.

## Local demo

Run the app locally using the setup instructions below. The role switcher sends
`X-Role` and `X-User` demo context to the backend for role-specific UI and
workflow testing. These caller-supplied values are not authentication and do
not provide production security; do not expose this demo API as a secured
multi-user service.

## What it does

See [FEATURES.md](FEATURES.md) for what is completed, partial and planned. It is kept up to date as work merges.

AI suggests. Humans decide. Nothing is published automatically.

## Repository layout

```
frontend/    Next.js app (Governance Hub, editor, review screens)
backend/     FastAPI service (API, review engine, approval workflow)
seed/        Sample brand used by "Load sample brand"
docs/        API contract and the issue list
```

## Run locally

Backend:

```
cd backend
pip install -r requirements.txt
cp .env.example .env # set a local database URL
uvicorn app.main:app --reload --port 8000
```

On startup, the backend creates missing tables and applies the additive schema
compatibility changes in `app/db.py`. This repository does not currently use a
versioned migration tool.

Frontend:

```
cd frontend
npm install
npm run dev
```

In development, the frontend defaults to `http://localhost:8000`. Copy
`frontend/.env.example` to `frontend/.env.local` to configure it explicitly.
Copy `backend/.env.example` to `backend/.env`. Role and actor headers are
simulated demo context, not verified identities or secure authorization; keep
the backend limited to local demonstration and testing.
Production requires `NEXT_PUBLIC_API_BASE_URL` to be set to the deployed
backend's public HTTPS URL before building/deploying the frontend; production
does not fall back to the visitor's localhost. Add both the local development
origin and deployed frontend origin to backend `CORS_ORIGINS`.

## Environment variables

See [backend/.env.example](backend/.env.example) for private backend
configuration and [frontend/.env.example](frontend/.env.example) for the
public API URL. Never commit real keys.

## How we work

- One issue, one branch, one pull request. Branch names: `feat/<issue#>-short-name`.
- The other teammate reviews every PR. Squash-merge into `main`; never push to `main` directly.
- `main` always works and deploys automatically.
- The API shapes are fixed in [docs/API_CONTRACT.md](docs/API_CONTRACT.md). Change the contract in a PR before changing the code.

## Technology

Next.js (React) · FastAPI (Python) · SQLite or PostgreSQL · hosted LLM API plus deterministic rule checks.

## Team

- Akshatha K: team leader, frontend
- Madhura Shastry: backend and review engine

## Disclosures

AI tools, libraries and licences used: `<LIST BEFORE SUBMITTING>`
