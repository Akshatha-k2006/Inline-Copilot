import logging
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import AuditEvent, Content, ContentImage, Finding
from app.schemas import (
    AuditEventResponse,
    ContentCreateRequest,
    ContentResponse,
    ContentUpdateRequest,
    ContentImageAltTextRequest,
    ContentImageResponse,
)

router = APIRouter(tags=["Content"])
logger = logging.getLogger(__name__)
UPLOAD_DIR = Path(__file__).resolve().parents[2] / "uploads"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _actor_name(value: str) -> str:
    actor = value.strip()
    suffix_start = actor.rfind(" (")
    if suffix_start == -1 or not actor.endswith(")"):
        return actor
    return actor[:suffix_start].rstrip()


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": code, "message": message})


def _authorize_content(content: Content, role: str, actor: str) -> None:
    if role == "creator" and content.created_by != _actor_name(actor):
        raise _error(403, "forbidden", "Creators can access only their own content.")


def _image_response(image: ContentImage) -> dict:
    return {
        "id": image.id,
        "content_id": image.content_id,
        "filename": image.filename,
        "mime_type": image.mime_type,
        "alt_text": image.alt_text,
        "url": f"/api/images/{image.id}/file",
        "created_at": image.created_at,
        "updated_at": image.updated_at,
    }


def _image_actor_allowed(content: Content, role: str, actor: str) -> None:
    _authorize_content(content, role, actor)
    if role != "creator" or content.status != "draft":
        raise _error(403, "forbidden", "Only the creator can edit images in a draft.")


@router.get("/content", response_model=list[ContentResponse])
def list_content(
    role: Annotated[str, Depends(get_role)],
    x_user: Annotated[str, Header()],
    db: Session = Depends(get_db),
    status: str | None = Query(default=None),
) -> list[Content]:
    statement = select(Content).order_by(Content.updated_at.desc(), Content.id.desc())
    if role == "creator":
        statement = statement.where(Content.created_by == _actor_name(x_user))
    if status:
        statement = statement.where(Content.status == status)
    try:
        return list(db.scalars(statement).all())
    except SQLAlchemyError as exc:
        logger.exception("Unable to load content list.")
        raise _error(500, "content_failed", "Unable to load content.") from exc


@router.post("/content", response_model=ContentResponse, status_code=201)
def create_content(
    request: ContentCreateRequest,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> Content:
    actor = _actor_name(x_user)
    if role != "creator":
        raise _error(403, "forbidden", "Only creators can create content.")
    if not actor:
        raise _error(422, "validation_error", "The request data is invalid.")
    content = Content(
        title=request.title,
        content_type=request.content_type,
        body=request.body,
        foreground_color=request.foreground_color,
        background_color=request.background_color,
        text_size=request.text_size,
        status="draft",
        version=1,
        created_by=actor,
    )
    try:
        db.add(content)
        db.flush()
        db.add(
            AuditEvent(
                content_id=content.id,
                actor=actor,
                action="content_created",
                details={"actor_role": role, "version": content.version},
            )
        )
        db.commit()
        db.refresh(content)
        return content
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to create content.")
        raise _error(500, "content_failed", "Unable to create content.") from exc


@router.get("/content/{content_id}", response_model=ContentResponse)
def get_content(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> Content:
    content = db.get(Content, content_id)
    if content is None:
        raise _error(404, "not_found", "Content not found.")
    _authorize_content(content, role, x_user)
    return content


@router.put("/content/{content_id}", response_model=ContentResponse)
def update_content(
    content_id: int,
    request: ContentUpdateRequest,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> Content:
    actor = _actor_name(x_user)
    try:
        content = (
            db.query(Content)
            .filter(Content.id == content_id)
            .with_for_update()
            .first()
        )
        if content is None:
            raise _error(404, "not_found", "Content not found.")
        _authorize_content(content, role, actor)
        if role != "creator" or content.status != "draft":
            raise _error(
                403,
                "forbidden",
                "Only the content's creator can edit a draft.",
            )
        if request.version != content.version:
            raise _error(409, "stale_content", "Content changed; refresh and try again.")

        old_version = content.version
        result = db.execute(
            update(Content)
            .where(Content.id == content.id, Content.version == old_version)
            .values(
                title=request.title,
                content_type=request.content_type,
                body=request.body,
                foreground_color=request.foreground_color,
                background_color=request.background_color,
                text_size=request.text_size,
                version=old_version + 1,
                reviewed_version=None,
                reviewed_at=None,
            ),
            execution_options={"synchronize_session": False},
        )
        if result.rowcount != 1:
            raise _error(409, "stale_content", "Content changed; refresh and try again.")
        db.add(
            AuditEvent(
                content_id=content.id,
                actor=actor,
                action="content_updated",
                details={"actor_role": role, "previous_version": old_version, "new_version": old_version + 1},
            )
        )
        db.commit()
        db.refresh(content)
        return content
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to update content.")
        raise _error(500, "content_failed", "Unable to update content.") from exc


@router.delete("/content/{content_id}", status_code=204)
def delete_content(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> None:
    actor = _actor_name(x_user)
    try:
        content = (
            db.query(Content)
            .filter(Content.id == content_id)
            .with_for_update()
            .first()
        )
        if content is None:
            raise _error(404, "not_found", "Content not found.")
        _authorize_content(content, role, actor)
        if role != "creator" or content.status != "draft":
            raise _error(
                403,
                "forbidden",
                "Only the content's creator can delete a draft.",
            )

        db.add(
            AuditEvent(
                content_id=None,
                actor=actor,
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
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to delete content.")
        raise _error(500, "content_failed", "Unable to delete content.") from exc


@router.get("/content/{content_id}/images", response_model=list[ContentImageResponse])
def list_content_images(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
):
    content = db.get(Content, content_id)
    if content is None:
        raise _error(404, "not_found", "Content not found.")
    _authorize_content(content, role, x_user)
    return [_image_response(item) for item in db.query(ContentImage).filter(
        ContentImage.content_id == content_id
    ).order_by(ContentImage.id).all()]


@router.post("/content/{content_id}/images", response_model=ContentImageResponse, status_code=201)
async def upload_content_image(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
    file: UploadFile = File(...),
):
    content = db.get(Content, content_id)
    if content is None:
        raise _error(404, "not_found", "Content not found.")
    actor = _actor_name(x_user)
    _image_actor_allowed(content, role, actor)
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise _error(422, "validation_error", "Only PNG, JPEG, and WebP images are supported.")
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise _error(413, "file_too_large", "Images must be 5 MB or smaller.")
    if not data:
        raise _error(422, "validation_error", "The image file is empty.")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    suffix = ".jpg" if file.content_type == "image/jpeg" else f".{file.content_type.split('/')[-1]}"
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}{suffix}"
    try:
        path.write_bytes(data)
        item = ContentImage(
            content_id=content_id,
            filename=file.filename or "image",
            mime_type=file.content_type,
            storage_path=str(path),
            alt_text="",
        )
        db.add(item)
        db.flush()
        db.add(AuditEvent(
            content_id=content_id,
            actor=actor,
            action="content_image_uploaded",
            details={"image_id": item.id, "filename": item.filename},
        ))
        db.commit()
        db.refresh(item)
        return _image_response(item)
    except OSError as exc:
        db.rollback()
        if path.exists():
            path.unlink()
        logger.exception("Unable to store content image.")
        raise _error(500, "image_upload_failed", "Unable to store the image.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        if path.exists():
            path.unlink()
        logger.exception("Unable to persist content image.")
        raise _error(500, "image_upload_failed", "Unable to save the image.") from exc


@router.patch("/content-images/{image_id}", response_model=ContentImageResponse)
def update_content_image_alt_text(
    image_id: int,
    payload: ContentImageAltTextRequest,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
):
    image = db.get(ContentImage, image_id)
    if image is None:
        raise _error(404, "not_found", "Image not found.")
    content = db.get(Content, image.content_id)
    if content is None:
        raise _error(404, "not_found", "Content not found.")
    actor = _actor_name(x_user)
    _image_actor_allowed(content, role, actor)
    image.alt_text = payload.alt_text.strip()
    db.add(AuditEvent(
        content_id=content.id,
        actor=actor,
        action="content_image_alt_text_updated",
        details={"image_id": image.id, "has_alt_text": bool(image.alt_text)},
    ))
    db.commit()
    db.refresh(image)
    return _image_response(image)


@router.get("/images/{image_id}/file")
def get_content_image_file(image_id: int, db: Session = Depends(get_db)):
    image = db.get(ContentImage, image_id)
    if image is None:
        raise _error(404, "not_found", "Image not found.")
    path = Path(image.storage_path)
    if not path.is_file():
        raise _error(404, "not_found", "Image file is unavailable.")
    return FileResponse(path, media_type=image.mime_type, filename=image.filename)


@router.get("/content/{content_id}/findings")
def get_content_findings(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> dict:
    content = db.get(Content, content_id)
    if content is None:
        raise _error(404, "not_found", "Content not found.")
    _authorize_content(content, role, x_user)
    findings = db.scalars(
        select(Finding)
        .where(Finding.content_id == content_id)
        .order_by(Finding.start_offset, Finding.id)
    ).all()
    return {
        "content_id": content_id,
        "content_version": content.version,
        "reviewed_version": content.reviewed_version,
        "findings": [
            {
                "id": item.id,
                "check": item.check_type,
                "guideline_id": item.guideline_id,
                "severity": item.severity,
                "message": item.message,
                "evidence": item.evidence,
                "suggested_fix": item.suggested_fix,
                "start_offset": item.start_offset,
                "end_offset": item.end_offset,
                "status": item.status,
                "content_version": item.content_version,
            }
            for item in findings
        ],
    }


@router.get("/content/{content_id}/audit", response_model=list[AuditEventResponse])
def get_content_audit(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> list[AuditEvent]:
    content = db.get(Content, content_id)
    if content is None:
        raise _error(404, "not_found", "Content not found.")
    _authorize_content(content, role, x_user)
    return list(
        db.scalars(
            select(AuditEvent)
            .where(AuditEvent.content_id == content_id)
            .order_by(AuditEvent.created_at, AuditEvent.id)
        ).all()
    )


@router.get("/audit", response_model=list[AuditEventResponse])
def get_audit(
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
) -> list[AuditEvent]:
    statement = select(AuditEvent).order_by(AuditEvent.created_at, AuditEvent.id)
    if role == "creator":
        owned_ids = select(Content.id).where(Content.created_by == _actor_name(x_user))
        statement = statement.where(AuditEvent.content_id.in_(owned_ids))
    return list(db.scalars(statement).all())
