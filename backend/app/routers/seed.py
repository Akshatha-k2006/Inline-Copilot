
import json
import logging
import shutil
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import require_writer
from app.models import (
    Asset,
    AuditEvent,
    Content,
    ContentImage,
    EvidenceRequest,
    Fact,
    Finding,
    Guideline,
    Term,
)

router = APIRouter(tags=["seed"])
logger = logging.getLogger(__name__)

# Resolve the file relative to the backend directory.
SEED_FILE = Path(__file__).resolve().parents[3] / "seed" / "brand.json"
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"


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
                foreground_color=draft.get("foreground_color"),
                background_color=draft.get("background_color"),
                text_size=draft.get("text_size"),
                status="draft",
                version=1,
                created_by="Asha",
            )
            db.add(sample_content)
            db.flush()
        else:
            if sample_content.foreground_color is None:
                sample_content.foreground_color = draft.get("foreground_color")
            if sample_content.background_color is None:
                sample_content.background_color = draft.get("background_color")
            if sample_content.text_size is None:
                sample_content.text_size = draft.get("text_size")

        legacy_demo_reason = (
            "Provide approved comparative evidence before this superlative "
            "claim can be published."
        )
        legacy_requests = (
            db.query(EvidenceRequest)
            .filter(EvidenceRequest.reason == legacy_demo_reason)
            .all()
        )
        for request in legacy_requests:
            finding = db.get(Finding, request.finding_id)
            if (
                finding is None
                or finding.content_id != sample_content.id
                or finding.check_type != "unsupported_claim"
                or finding.status != "resolved"
                or not isinstance(finding.evidence, dict)
                or finding.evidence.get("matched_text") != request.claim_text
            ):
                continue
            db.delete(request)
            db.flush()
            if (
                db.query(EvidenceRequest)
                .filter(EvidenceRequest.finding_id == finding.id)
                .first()
                is None
            ):
                db.delete(finding)

        demo_image = data["demo_image"]
        image_source = SEED_FILE.parent / demo_image["source_file"]
        image_path = UPLOAD_DIR / demo_image["filename"]
        if not image_path.is_file():
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(image_source, image_path)
        sample_image = (
            db.query(ContentImage)
            .filter(
                ContentImage.content_id == sample_content.id,
                ContentImage.filename == demo_image["filename"],
            )
            .first()
        )
        if sample_image is None:
            sample_image = ContentImage(
                content_id=sample_content.id,
                filename=demo_image["filename"],
                mime_type="image/png",
                storage_path=str(image_path),
                alt_text=demo_image["alt_text"],
            )
            db.add(sample_image)

        other_content = (
            db.query(Content).filter(Content.id != sample_content.id).all()
        )
        other_content_ids = [content.id for content in other_content]
        if other_content_ids:
            other_finding_ids = [
                finding_id
                for (finding_id,) in db.query(Finding.id)
                .filter(Finding.content_id.in_(other_content_ids))
                .all()
            ]
            if other_finding_ids:
                (
                    db.query(EvidenceRequest)
                    .filter(EvidenceRequest.finding_id.in_(other_finding_ids))
                    .delete(synchronize_session=False)
                )
            for content in other_content:
                db.add(
                    AuditEvent(
                        content_id=None,
                        actor=role,
                        action="content_deleted",
                        details={
                            "actor_role": role,
                            "content_id": content.id,
                            "title": content.title,
                            "version": content.version,
                        },
                    )
                )
                db.delete(content)

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
                "images": int(sample_image is not None),
                "evidence_requests": 0,
                "removed_content": len(other_content),
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
