import logging
import re
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import AuditEvent, Content, Finding
from app.schemas import (
    AuditEventResponse,
    ContentCreateRequest,
    ContentResponse,
    ContentUpdateRequest,
)

router = APIRouter(tags=["Content"])
logger = logging.getLogger(__name__)


def _actor_name(value: str) -> str:
    return re.sub(r"\s+\([^)]*\)$", "", value.strip())


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": code, "message": message})


def _authorize_content(content: Content, role: str, actor: str) -> None:
    if role == "creator" and content.created_by != _actor_name(actor):
        raise _error(403, "forbidden", "Creators can access only their own content.")


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
