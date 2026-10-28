import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.exception("Health check could not reach the database.")
        raise HTTPException(
            status_code=503,
            detail={
                "error": "database_unavailable",
                "message": "The backend database is temporarily unavailable.",
            },
        ) from exc
    return {"status": "ok"}