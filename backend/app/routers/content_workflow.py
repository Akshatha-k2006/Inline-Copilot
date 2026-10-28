import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import AuditEvent, Comment, Content
from app.schemas import (
    ContentResponse,
    ContentStatusResponse,
    ContentUpdate,
    ContentCommentsResponse,
    ReviewCommentCreateRequest,
    ReviewCommentResponse,
    ReviewDecisionRequest,
    ReviewDecisionResponse,
)
from app.services.content_workflow import transition_content_status

router = APIRouter(tags=["Content workflow"])
logger = logging.getLogger(__name__)

def _authorize_creator(content_id: int, role: str, actor: str, db: Session) -> None:
    if role != "creator":
        return
    content = db.get(Content, content_id)
    if content is None:
        return
    normalized_actor = actor.strip().rsplit(" (", 1)[0]
    if content.created_by != normalized_actor:
        raise HTTPException(
            status_code=403,
            detail={"error": "forbidden", "message": "Creators can act only on their own content."},
        )


@router.get("/content/{content_id}", response_model=ContentResponse)
def get_content(
    content_id: int,
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentResponse:
    content = db.get(Content, content_id)
    if content is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Content not found."},
        )
    return ContentResponse.model_validate(content)


@router.put("/content/{content_id}", response_model=ContentResponse)
def update_content(
    content_id: int,
    request: ContentUpdate,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentResponse:
    actor = x_user.strip()
    content = db.get(Content, content_id)
    if content is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Content not found."},
        )
    if role != "creator" or content.created_by != actor:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "Only the content creator can edit this draft.",
            },
        )
    if not actor or not request.title.strip() or not request.body.strip():
        raise HTTPException(
            status_code=422,
            detail={
                "error": "validation_error",
                "message": "A title and content body are required.",
            },
        )
    if content.status not in {"draft", "changes_requested"}:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "invalid_status_transition",
                "message": "Only editable drafts can be updated.",
            },
        )

    content.title = request.title
    content.body = request.body
    content.version += 1
    db.commit()
    db.refresh(content)
    return ContentResponse.model_validate(content)


@router.post(
    "/content/{content_id}/self-check",
    response_model=ContentStatusResponse,
)
def self_check_content(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentStatusResponse:
    try:
        content = transition_content_status(
            db, content_id, "self_checked", x_user, role
        )
    except SQLAlchemyError as exc:
        logger.exception("Unable to self-check content.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "workflow_failed",
                "message": "Unable to self-check content.",
            },
        ) from exc
    return ContentStatusResponse(
        content_id=content.id,
        status=content.status,
        content_version=content.version,
    )


@router.post(
    "/content/{content_id}/submit",
    response_model=ContentStatusResponse,
)
def submit_content(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentStatusResponse:
    _authorize_creator(content_id, role, x_user, db)
    try:
        content = transition_content_status(
            db,
            content_id,
            "in_review",
            x_user,
            role,
        )
    except SQLAlchemyError as exc:
        logger.exception("Unable to submit content for review.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "workflow_failed",
                "message": "Unable to submit content for review.",
            },
        ) from exc

    return ContentStatusResponse(
        content_id=content.id,
        status=content.status,
        content_version=content.version,
    )


@router.post(
    "/content/{content_id}/decision",
    response_model=ReviewDecisionResponse,
)
def decide_content_review(
    content_id: int,
    request: ReviewDecisionRequest,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ReviewDecisionResponse:
    new_status = {
        "approve": "approved",
        "request_changes": "draft",
    }[request.decision]
    review_comment = (
        Comment(
            content_id=content_id,
            author=x_user,
            body=request.comment,
        )
        if request.comment is not None
        else None
    )

    try:
        content = transition_content_status(
            db,
            content_id,
            new_status,
            x_user,
            role,
            review_comment=review_comment,
        )
    except SQLAlchemyError as exc:
        logger.exception("Unable to save content review decision.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "workflow_failed",
                "message": "Unable to save review decision.",
            },
        ) from exc

    return ReviewDecisionResponse(
        content_id=content.id,
        status=content.status,
        content_version=content.version,
        comment=(
            ReviewCommentResponse.model_validate(review_comment)
            if review_comment is not None
            else None
        ),
    )


@router.post(
    "/content/{content_id}/ready-to-publish",
    response_model=ContentStatusResponse,
)
def mark_content_ready_to_publish(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentStatusResponse:
    try:
        content = transition_content_status(
            db,
            content_id,
            "ready_to_publish",
            x_user,
            role,
        )
    except SQLAlchemyError as exc:
        logger.exception("Unable to mark content ready to publish.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "workflow_failed",
                "message": "Unable to update content status.",
            },
        ) from exc

    return ContentStatusResponse(
        content_id=content.id,
        status=content.status,
        content_version=content.version,
    )


@router.post(
    "/content/{content_id}/self-check",
    response_model=ContentStatusResponse,
)
def self_check_content(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentStatusResponse:
    _authorize_creator(content_id, role, x_user, db)
    try:
        content = transition_content_status(
            db, content_id, "self_checked", x_user, role
        )
    except SQLAlchemyError as exc:
        logger.exception("Unable to mark content self-checked.")
        raise HTTPException(
            status_code=500,
            detail={"error": "workflow_failed", "message": "Unable to complete content check."},
        ) from exc
    return ContentStatusResponse(
        content_id=content.id,
        status=content.status,
        content_version=content.version,
    )


@router.post(
    "/content/{content_id}/comments",
    response_model=ReviewCommentResponse,
    status_code=201,
)
def add_review_comment(
    content_id: int,
    request: ReviewCommentCreateRequest,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ReviewCommentResponse:
    actor = x_user.strip()
    try:
        content = (
            db.query(Content)
            .filter(Content.id == content_id)
            .with_for_update()
            .first()
        )
        if content is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": "Content not found."},
            )
        if role != "reviewer" or content.status != "in_review":
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "forbidden",
                    "message": (
                        "Only reviewers can comment while content is in review."
                    ),
                },
            )
        if not actor:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "validation_error",
                    "message": "The request data is invalid.",
                },
            )

        comment = Comment(
            content_id=content.id,
            author=actor,
            body=request.body,
        )
        db.add(comment)
        db.flush()
        db.add(
            AuditEvent(
                content_id=content.id,
                actor=actor,
                action="comment_added",
                details={"comment_id": comment.id, "actor_role": role},
            )
        )
        db.refresh(comment)
        comment_response = ReviewCommentResponse.model_validate(comment)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to save review comment.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "workflow_failed",
                "message": "Unable to save review comment.",
            },
        ) from exc
    except Exception:
        db.rollback()
        raise

    return comment_response


@router.get(
    "/content/{content_id}/comments",
    response_model=ContentCommentsResponse,
)
def get_review_comments(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Annotated[Session, Depends(get_db)],
) -> ContentCommentsResponse:
    actor = x_user.strip()
    try:
        content = db.get(Content, content_id)
        if content is None:
            raise HTTPException(
                status_code=404,
                detail={"error": "not_found", "message": "Content not found."},
            )
        if not actor:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "validation_error",
                    "message": "The request data is invalid.",
                },
            )
        if role == "creator":
            can_read = content.created_by == actor.rsplit(" (", 1)[0]
        else:
            can_read = role in {"reviewer", "brand_manager", "admin"}
        if not can_read:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "forbidden",
                    "message": "This role cannot access these content comments.",
                },
            )

        comments = db.scalars(
            select(Comment)
            .where(Comment.content_id == content_id)
            .order_by(Comment.created_at, Comment.id)
        ).all()
        return ContentCommentsResponse(
            content_id=content.id,
            comments=comments,
        )
    except HTTPException:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Unable to load review comments.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "workflow_failed",
                "message": "Unable to load review comments.",
            },
        ) from exc
