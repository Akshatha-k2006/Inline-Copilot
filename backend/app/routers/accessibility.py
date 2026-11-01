from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.schemas import ContrastCheckRequest
from app.services.accessibility_checker import check_contrast

router = APIRouter(prefix="/accessibility", tags=["Accessibility"])


@router.post("/contrast", dependencies=[Depends(get_role)])
def check_color_contrast(
    payload: ContrastCheckRequest,
    db: Annotated[Session, Depends(get_db)],
):
    try:
        return check_contrast(
            db,
            payload.foreground_color,
            payload.background_color,
            payload.text_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "brand_palette_unavailable",
                "message": str(exc),
            },
        ) from exc
