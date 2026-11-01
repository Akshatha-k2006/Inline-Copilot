
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import Base, engine, ensure_model_schema, migrate_review_schema
from app import models
from app.exception_handlers import (
    CatchUnhandledExceptionsMiddleware,
    register_exception_handlers,
)
from app.routers import (
    health,
    seed,
    guidelines,
    glossary,
    facts,
    assets,
    review,
    content_workflow,
    content,
    evidence_requests,
    accessibility,
)
app = FastAPI(title="CoRESpace — Inline Copilot API")
register_exception_handlers(app)

origins = [
    origin.strip()
    for origin in settings.cors_origins.split(",")
    if origin.strip()
]

app.add_middleware(CatchUnhandledExceptionsMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)
ensure_model_schema(engine)
migrate_review_schema(engine)

app.include_router(health.router, prefix="/api")
app.include_router(seed.router, prefix="/api")
app.include_router(guidelines.router, prefix="/api")
app.include_router(glossary.router, prefix="/api")
app.include_router(facts.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(review.router, prefix="/api")
app.include_router(content_workflow.router, prefix="/api")
app.include_router(content.router, prefix="/api")
app.include_router(evidence_requests.router, prefix="/api")
app.include_router(accessibility.router, prefix="/api")