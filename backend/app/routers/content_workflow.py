import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import Comment
from app.schemas import (
    ContentStatusResponse,
    ReviewCommentResponse,
    ReviewDecisionRequest,
    ReviewDecisionResponse,
)
from app.services.content_workflow import transition_content_status

router = APIRouter(tags=["Content workflow"])
logger = logging.getLogger(__name__)


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
