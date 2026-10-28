
import json
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import require_writer
from app.models import Asset, Comment, Content, Fact, Finding, Guideline, Term

router = APIRouter(tags=["seed"])

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

        # Remove previous sample data and dependent records.
        # Preserve other content items, if any.
        sample_content = db.get(Content, 1)
        if sample_content:
            db.delete(sample_content)
            db.flush()

        db.query(Guideline).delete(synchronize_session=False)
        db.query(Term).delete(synchronize_session=False)
        db.query(Fact).delete(synchronize_session=False)
        db.query(Asset).delete(synchronize_session=False)
        db.flush()

        for item in data["guidelines"]:
            db.add(
                Guideline(
                    id=item["id"],
                    title=item["title"],
                    description=item["body"],
                    category=item["kind"],
                )
            )

        for item in data["terms"]:
            db.add(
                Term(
                    id=item["id"],
                    term=item["term"],
                    definition=item.get("definition", item.get("reason", "")),
                    replacement=item.get("preferred") or None,
                    status=item["status"],
                    explanation=item.get("reason", ""),
                )
            )

        for item in data["facts"]:
            db.add(
                Fact(
                    id=item["id"],
                    statement=item["statement"],
                    source=item["source"],
                    owner=item.get("owner", ""),
                    review_by=parse_review_date(item["review_by"]),
                )
            )

        for item in data["assets"]:
            db.add(
                Asset(
                    id=item["id"],
                    name=item["name"],
                    asset_type=item["kind"],
                    description=item.get("description", item.get("notes", "")),
                    url=item.get("url", ""),
                    metadata_json={"notes": item.get("notes", "")},
                )
            )

        draft = data["sample_draft"]
        db.add(
            Content(
                id=1,
                title=draft["title"],
                body=draft["body"],
                status="draft",
                version=1,
                created_by="seed",
            )
        )

        db.flush()

        # Explicit IDs are required by the sample-data contract.
        # Reset PostgreSQL sequences so future inserts won't collide.
        for table in ("guidelines", "terms", "facts", "assets", "content"):
            db.execute(
                __import__("sqlalchemy").text(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table}), 1), "
                    f"EXISTS (SELECT 1 FROM {table}))"
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
            "expired_fact_id": 2,
            "sample_content_id": 1,
        }

    except FileNotFoundError:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Seed file not found: {SEED_FILE}",
        )
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load seed data: {exc}",
        )
