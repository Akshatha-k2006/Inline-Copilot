import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.schemas import ContentStatusResponse
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
