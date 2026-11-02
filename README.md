# Inline Copilot

Inline Copilot is an AI-assisted brand governance platform built to help teams review marketing content before publication. It combines approved brand knowledge, automated content checks, role-based approval workflows, and evidence-backed review feedback in a single workspace.

The platform is designed for demo and internal validation use: creators draft content, reviewers inspect findings, brand managers approve workflow steps, and admins manage the governance process. AI supports the review process, but human approval remains the final decision.

## Project Overview

- AI-powered review of draft content against approved guidelines, facts, and terminology
- Role-based user workflow for creators, reviewers, brand managers, and admins
- Knowledge management for guidelines, glossary entries, approved facts, and assets
- Review queue and audit trail for governance visibility
- Demo-only header-based role simulation

## Project Structure

```text
Inline-Copilot/
├─ backend/                        # FastAPI application and business logic
│  ├─ app/                         # Core backend source code
│  │  ├─ routers/                  # API route definitions
│  │  ├─ services/                 # Review, validation, and workflow services
│  │  ├─ models.py                 # Database models
│  │  ├─ schemas.py                # Request/response schemas
│  │  ├─ config.py                 # Environment configuration
│  │  ├─ db.py                     # Database setup and migrations
│  │  ├─ dependencies.py           # Dependency injection helpers
│  │  ├─ exception_handlers.py     # Global exception handling
│  │  └─ main.py                   # FastAPI app entry point
│  ├─ tests/                       # Backend test suite
│  ├─ requirements.txt             # Python dependencies
│  ├─ .env.example                 # Example backend environment configuration
│  └─ .env                         # Local backend environment (not committed)
├─ frontend/                       # Next.js frontend application
│  ├─ src/                         # Frontend source code
│  │  ├─ app/                      # App Router pages and layouts
│  │  ├─ components/               # Reusable UI components
│  │  ├─ lib/                      # API utilities and shared logic
│  │  └─ .. .#
│  ├─ mocks/                       # Mock data for local development and validation
│  ├─ package.json                 # Frontend scripts and dependencies
│  ├─ package-lock.json            # Lockfile
│  ├─ .env.example                 # Example frontend environment configuration
│  └─ .env.local                   # Local frontend environment (not committed)
├─ docs/                           # Product and engineering documentation
│  ├─ API_CONTRACT.md              # API contracts and payload structure
│  ├─ DESIGN.md                    # Design overview
│  ├─ FEATURES.md                  # Feature roadmap and completion status
│  └─ PRODUCT_AUDIT.md             # Audit and evaluation notes
├─ seed/                           # Seed data for demo brand initialization
│  └─ brand.json#
├─ README.md                       # Project overview and setup guide
├─ .gitignore                      # Repository ignore rules
```

## Features

See [docs/FEATURES.md](docs/FEATURES.md) for the current feature status, including completed work, known limitations, and planned enhancements.

## Tech Stack

- Frontend: Next.js, React, TypeScript
- Backend: FastAPI, Python, SQLAlchemy
- Database: SQLite for local development, PostgreSQL-ready configuration

## Getting Started

### Prerequisites

- Node.js and npm
- Python 3.11+
- A local terminal with access to project files

### Backend Setup

```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

The backend API runs on `http://localhost:8000` by default. On startup, it creates required tables and applies compatibility updates for the local schema.

### Frontend Setup

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

The frontend runs on `http://localhost:3000` and reads the API base URL from `NEXT_PUBLIC_API_BASE_URL` in the frontend environment file.

### Environment Configuration

- Backend config: [backend/.env.example](backend/.env.example)
- Frontend config: [frontend/.env.example](frontend/.env.example)

Do not commit real secrets or production credentials. Keep local demo usage restricted to development/testing scenarios.

## Team Members

- Akshatha K — Team Lead, Frontend
- G Madhura Shastry — Backend and Review Engine

## Development Notes

- The app uses demo role headers (`X-Role` and `X-User`) to simulate role-based access for local testing.
- This is not a production authentication system and should not be exposed as a secure multi-user service.
- The project follows a single-issue / single-branch workflow and keeps API contract changes documented in the docs folder before implementation changes.

## Documentation

- [docs/API_CONTRACT.md](docs/API_CONTRACT.md)
- [docs/DESIGN.md](docs/DESIGN.md)
- [docs/FEATURES.md](docs/FEATURES.md)
- [docs/PRODUCT_AUDIT.md](docs/PRODUCT_AUDIT.md)
