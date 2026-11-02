
import json
import logging
from datetime import date, datetime, time, timezone
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role, require_writer
from app.models import (
    Asset,
    AuditEvent,
    Comment,
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

# Resolve the fixture from the repository root.
SEED_FILE = Path(__file__).resolve().parents[3] / "seed" / "brand.json"


def parse_review_date(value: str) -> datetime:
    parsed = date.fromisoformat(value)
    return datetime.combine(parsed, time.min, tzinfo=timezone.utc)


def sync_sample_content(
    db: Session,
    draft: dict[str, Any],
    demo_image: dict[str, Any],
    *,
    reset_content: bool = True,
) -> tuple[Content, ContentImage]:
    sample_content = (
        db.query(Content)
        .filter(
            Content.title == draft["title"],
            Content.created_by == "Asha",
        )
        .order_by(Content.id)
        .first()
    )
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
    elif reset_content:
        content_changed = any(
            (
                sample_content.title != draft["title"],
                sample_content.content_type != "social_media",
                sample_content.body != draft["body"],
                sample_content.foreground_color != draft.get("foreground_color"),
                sample_content.background_color != draft.get("background_color"),
                sample_content.text_size != draft.get("text_size"),
                sample_content.status != "draft",
            )
        )
        if content_changed:
            sample_content.version += 1
        sample_content.title = draft["title"]
        sample_content.content_type = "social_media"
        sample_content.body = draft["body"]
        sample_content.foreground_color = draft.get("foreground_color")
        sample_content.background_color = draft.get("background_color")
        sample_content.text_size = draft.get("text_size")
        sample_content.status = "draft"
        sample_content.reviewed_version = None
        sample_content.reviewed_at = None

    image_source = SEED_FILE.parent / demo_image["source_file"]
    if not image_source.is_file():
        raise FileNotFoundError(image_source)
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
            storage_path=str(image_source),
            alt_text=demo_image["alt_text"],
        )
        db.add(sample_image)
    else:
        sample_image.mime_type = "image/png"
        sample_image.storage_path = str(image_source)
        sample_image.alt_text = demo_image["alt_text"]
    return sample_content, sample_image


@router.post("/demo/reset-sample")
def reset_sample_demo(
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
):
    if role != "creator":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "Only the Creator can reset the demo sample.",
            },
        )
    try:
        with SEED_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
        sample_content, sample_image = sync_sample_content(
            db, data["sample_draft"], data["demo_image"]
        )
        finding_ids = [
            finding_id
            for (finding_id,) in db.query(Finding.id)
            .filter(Finding.content_id == sample_content.id)
            .all()
        ]
        if finding_ids:
            db.query(EvidenceRequest).filter(
                EvidenceRequest.finding_id.in_(finding_ids)
            ).delete(synchronize_session=False)
            for finding_id in finding_ids:
                finding = db.get(Finding, finding_id)
                if finding is not None:
                    db.delete(finding)
        db.query(Comment).filter(
            Comment.content_id == sample_content.id
        ).delete(synchronize_session=False)
        for image in (
            db.query(ContentImage)
            .filter(
                ContentImage.content_id == sample_content.id,
                ContentImage.id != sample_image.id,
            )
            .all()
        ):
            db.delete(image)
        db.add(
            AuditEvent(
                content_id=sample_content.id,
                actor="Asha",
                action="demo_sample_reset",
                details={
                    "actor_role": role,
                    "content_version": sample_content.version,
                },
            )
        )
        db.commit()
        return {
            "message": "Demo sample restored.",
            "content_id": sample_content.id,
            "content_version": sample_content.version,
            "image_id": sample_image.id,
        }
    except Exception as exc:
        db.rollback()
        logger.exception("Unable to reset the demo sample.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "demo_reset_failed",
                "message": "Unable to reset the demo sample.",
            },
        ) from exc


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

        sample_content, sample_image = sync_sample_content(
            db, data["sample_draft"], data["demo_image"]
        )

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
