# Inline-Copilot

An AI-powered brand governance platform that reviews content against approved brand guidelines, verifies claims against approved facts, and provides evidence-backed suggestions before publication. Features a Governance Hub for content review, approvals, and brand consistency insights.

## Try it (no login)

1. Open the live link: `<ADD DEPLOYED URL>`
2. Click **Load sample brand**.
3. Click **Run review** on the sample draft (or paste your own text).
4. Accept, edit or dismiss each flag.
5. Submit for review, switch role to **Reviewer** (top bar), then approve or request changes.

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
cp ../.env .env      # then fill in values
uvicorn app.main:app --reload --port 8000
```

Frontend:

```
cd frontend
npm install
npm run dev
```

The frontend reads `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

## Environment variables

See [.env.example](.env.example). Never commit real keys.

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
