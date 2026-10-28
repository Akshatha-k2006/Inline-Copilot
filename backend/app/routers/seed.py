
import json
import logging
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import require_writer
from app.models import Asset, AuditEvent, Content, Fact, Guideline, Term

router = APIRouter(tags=["seed"])
logger = logging.getLogger(__name__)

# Resolve the file relative to the backend directory.
SEED_FILE = Path(__file__).resolve().parents[3] / "seed" / "brand.json"


def parse_review_date(value: str) -> datetime:
    parsed = date.fromisoformat(value)
    return datetime.combine(parsed, time.min, tzinfo=timezone.utc)


@router.post("/seed/load")
def load_seed_data(
    role: Annotated[str, Depends(require_writer)],
    db: Session = Depends(get_db),
):
    try:
        with SEED_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)

        guideline_ids = {}
        for item in data["guidelines"]:
            existing = (
                db.query(Guideline)
                .filter(Guideline.title == item["title"])
                .first()
            )
            if existing is None:
                existing = Guideline(
                    title=item["title"],
                    description=item["body"],
                    category=item["kind"],
                )
                db.add(existing)
                db.flush()
            guideline_ids[item["id"]] = existing.id

        for item in data["terms"]:
            existing = (
                db.query(Term)
                .filter(func.lower(Term.term) == item["term"].lower())
                .first()
            )
            if existing is None:
                db.add(
                    Term(
                        term=item["term"],
                        definition=item.get("definition", item.get("reason", "")),
                        replacement=item.get("preferred") or None,
                        status=item["status"],
                        explanation=item.get("reason", ""),
                        guideline_id=guideline_ids.get(item.get("guideline_id")),
                    )
                )

        for item in data["facts"]:
            existing = (
                db.query(Fact)
                .filter(Fact.statement == item["statement"])
                .first()
            )
            if existing is None:
                db.add(
                    Fact(
                        statement=item["statement"],
                        source=item["source"],
                        owner=item.get("owner", ""),
                        last_reviewed=(
                            parse_review_date(item["last_reviewed"])
                            if item.get("last_reviewed")
                            else None
                        ),
                        review_by=parse_review_date(item["review_by"]),
                    )
                )

        for item in data["assets"]:
            existing = db.query(Asset).filter(Asset.name == item["name"]).first()
            if existing is None:
                db.add(
                    Asset(
                        name=item["name"],
                        asset_type=item["kind"],
                        description=item.get("description", item.get("notes", "")),
                        url=item.get("url", ""),
                        metadata_json={"notes": item.get("notes", "")},
                    )
                )

        draft = data["sample_draft"]
        sample_content = (
            db.query(Content)
            .filter(
                Content.title == draft["title"],
                Content.created_by == "Asha",
            )
            .order_by(Content.id)
            .first()
        )
        db.flush()
        if sample_content is None:
            sample_content = Content(
                title=draft["title"],
                content_type="social_media",
                body=draft["body"],
                status="draft",
                version=1,
                created_by="Asha",
            )
            db.add(sample_content)
            db.flush()

        expired_fact = (
            db.query(Fact)
            .filter(Fact.statement == data["facts"][1]["statement"])
            .first()
        )
        db.add(
            AuditEvent(
                actor=role,
                action="sample_brand_loaded",
                details={
                    "actor_role": role,
                    "brand": data["brand"],
                    "sample_content_id": sample_content.id,
                },
            )
        )
        db.commit()

        return {
            "message": "Sample brand loaded successfully",
            "brand": data["brand"],
            "counts": {
                "guidelines": len(data["guidelines"]),
                "terms": len(data["terms"]),
                "facts": len(data["facts"]),
                "assets": len(data["assets"]),
                "content": 1,
            },
            "expired_fact_id": expired_fact.id,
            "sample_content_id": sample_content.id,
        }

    except FileNotFoundError as exc:
        db.rollback()
        logger.exception("Sample brand seed file is missing.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "seed_failed",
                "message": "The sample brand data file is unavailable.",
            },
        ) from exc
    except Exception as exc:
        db.rollback()
        logger.exception("Unable to load sample brand data.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "seed_failed",
                "message": "Unable to load sample brand data.",
            },
        ) from exc
