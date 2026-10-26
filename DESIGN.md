# Design and file structure

How Inline Copilot is organised, who owns which part, and where new code goes. Issue numbers refer to `docs/ISSUES.md`.

## Overview

```
 Browser (Next.js)  ──HTTP/JSON──▶  FastAPI  ──▶  Review engine (rules first, LLM second)
   Governance Hub                     │                      │
   Editor + findings                  ▼                      ▼
   Review queue                  SQLite / PostgreSQL   Hosted LLM API (optional, with timeout)
```

- The frontend is thin. All checking happens in the backend so every screen gets the same results.
- Deterministic rules run first. The LLM handles judgment calls (tone, messaging, claim wording). If the LLM fails, rule results are still returned.
- Every finding carries a citation to the guideline, glossary term or fact it came from.
- No login. A role switcher sends `X-Role` and `X-User` headers; the backend enforces them (see `docs/API_CONTRACT.md`).

## Repository tree

```
inline-copilot/
├── README.md                  How to try it, run it, and how we work
├── FEATURES.md                Completed / partial / planned
├── DESIGN.md                  This file
├── .env.example               Variables for backend and frontend
├── .gitignore
├── docs/
│   ├── API_CONTRACT.md        Endpoints and JSON shapes (source of truth)
│
├── seed/
│   └── brand.json             Sample brand, draft and expected findings
│
├── backend/                   Owner: Madhura
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py            FastAPI app, CORS, router registration            (#3)
│   │   ├── config.py          Reads environment variables                        (#3)
│   │   ├── db.py              Engine, session, create tables                     (#3)
│   │   ├── models.py          Tables: Guideline, Term, Fact, Asset, Content,
│   │   │                      Finding, Comment, AuditEvent                        (#3)
│   │   ├── schemas.py         Pydantic request/response models = the contract    (#3)
│   │   ├── deps.py            Reads X-Role / X-User, require_role()              (#5)
│   │   ├── routers/
│   │   │   ├── health.py      GET /api/health                                    (#3)
│   │   │   ├── seed.py        POST /api/seed/load                                (#4)
│   │   │   ├── knowledge.py   CRUD: guidelines, terms, facts, assets             (#5)
│   │   │   ├── content.py     Create/get/update content, GET /queue              (#11)
│   │   │   ├── review.py      POST /content/{id}/review, PATCH /findings/{id}    (#11)
│   │   │   └── approval.py    submit, decision, ready, comments, audit           (#15)
│   │   ├── engine/            One file per check. Each exposes
│   │   │   │                  run(text, kb) -> list[FindingDraft]
│   │   │   ├── __init__.py    run_review(): runs all checks, merges, sorts        (#11)
│   │   │   ├── types.py       FindingDraft (check, severity, start, end, source…)
│   │   │   ├── terminology.py Prohibited / preferred terms                       (#7)
│   │   │   ├── claims.py      Claim detection, fact matching, outdated facts     (#8)
│   │   │   ├── tone.py        Tone and messaging via LLM, rule fallback          (#9)
│   │   │   ├── llm.py         Provider wrapper, timeout, returns None on failure (#9)
│   │   │   └── fixes.py       Minimal-rewrite suggestions                        (#10)
│   │   └── services/
│   │       ├── workflow.py    Allowed status transitions                         (#15)
│   │       ├── audit.py       record(event) helper used by every write           (#15)
│   │       └── seed_loader.py Loads seed/brand.json                              (#4)
│   └── tests/
│       ├── test_terminology.py
│       ├── test_claims.py     Uses expected_findings from seed/brand.json
│       └── test_workflow.py
│
└── frontend/                  Owner: Akshatha
    ├── package.json
    ├── next.config.js
    └── src/
        ├── app/               Pages (Next.js App Router)
        │   ├── layout.tsx     Top bar, role context, "how to try" banner        (#2, #18)
        │   ├── page.tsx       Home: Load sample brand, start here                (#6)
        │   ├── knowledge/page.tsx     Guidelines, Glossary, Facts, Assets tabs   (#6)
        │   ├── editor/[id]/page.tsx   Editor, highlights, findings, diff         (#12–14)
        │   ├── queue/page.tsx         Items waiting for review                   (#16)
        │   ├── review/[id]/page.tsx   Reviewer view: comments, approve/changes   (#16)
        │   └── audit/[id]/page.tsx    Audit timeline                             (#17)
        ├── components/
        │   ├── TopBar.tsx
        │   ├── RoleSwitcher.tsx       Creator / Reviewer / Brand manager / Admin (#2, #16)
        │   ├── StatusBadge.tsx        draft … ready to publish
        │   ├── HowToTry.tsx           Dismissible 5-step banner                  (#18)
        │   ├── knowledge/             TermsTable, FactsTable (Outdated badge), GuidelineList, AssetList, forms
        │   ├── editor/
        │   │   ├── Editor.tsx         Text area + Run review
        │   │   ├── HighlightedText.tsx  Draws spans from finding offsets
        │   │   ├── FindingsPanel.tsx
        │   │   ├── FindingCard.tsx    Check, severity, reason, cited source
        │   │   └── DiffView.tsx       Original vs suggestion, Accept / Edit / Dismiss
        │   ├── review/                DecisionBar.tsx, CommentBox.tsx
        │   └── audit/Timeline.tsx
        ├── lib/
        │   ├── api.ts         fetch wrapper, adds role headers, handles errors
        │   ├── types.ts       TypeScript types copied from the contract
        │   ├── role.tsx       React context for the current role and user
        │   └── highlight.ts   Turns text + findings into ordered segments
        └── mocks/             One example JSON per endpoint, used until the API is live
```

## Data flow for the main path

1. **Load sample brand:** `POST /api/seed/load` → `services/seed_loader.py` fills the tables and creates the sample draft.
2. **Run review:** `POST /api/content/{id}/review` → `engine.run_review()` runs terminology, claims and tone, stores findings for the current content version, returns them sorted by position.
3. **Resolve a finding:** `PATCH /api/findings/{id}` → body text is updated, version increases, an audit event is written.
4. **Submit and decide:** `submit` → `decision` → `ready` go through `services/workflow.py`, which rejects invalid transitions with `409` and writes an audit event for each.

## Rules for adding code

- **New check:** add `engine/<name>.py` exposing `run(text, kb)`, register it in `engine/__init__.py`, and add one test using `seed/brand.json`. Nothing else should need to change.
- **New endpoint:** update `docs/API_CONTRACT.md` first, then `schemas.py`, then the router.
- **New screen:** page in `src/app/`, components in `src/components/<area>/`, API calls only through `lib/api.ts`.
- **Findings must always cite a source.** If a check cannot name a guideline, term or fact, it should not raise a finding.
- **Secrets:** read from environment only (`config.py`). Never commit keys.

## Where the Round 3 improvements will go

| Improvement                     | Backend                                                                   | Frontend                                 |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------- |
| Advanced evidence management    | New fields on Fact (evidence request, attachments), `routers/evidence.py` | `components/knowledge/EvidencePanel.tsx` |
| Visual and accessibility checks | `engine/visual.py`, `engine/accessibility.py`, image upload route         | `components/editor/ImageCheck.tsx`       |
| Guideline health insights       | `routers/insights.py` (counts from findings and decisions)                | `app/insights/page.tsx`                  |
| Google Docs sidebar             | Reuses `POST /review` unchanged                                           | Separate add-on that calls the same API  |
