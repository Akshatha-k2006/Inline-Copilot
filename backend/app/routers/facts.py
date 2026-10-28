from datetime import date, datetime, time, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role, require_writer
from app.models import Fact
from app.schemas import FactCreate, FactResponse
from app.services.audit import record_knowledge_change

router = APIRouter(prefix="/facts", tags=["facts"])

DbSession = Annotated[Session, Depends(get_db)]

def is_outdated(review_by: datetime | None) -> bool:
    if review_by is None:
        return False

    if review_by.tzinfo is None:
        review_by = review_by.replace(tzinfo=timezone.utc)

    return review_by.date() < datetime.now(timezone.utc).date()

def to_response(item: Fact) -> dict:
    return {
        "id": item.id,
        "claim": item.statement,
        "owner": item.owner,
        "reviewDate": item.review_by.date().isoformat() if item.review_by else None,
        "source": item.source,
        "lastReviewed": (
            item.last_reviewed.date().isoformat() if item.last_reviewed else None
        ),
        "outdated": is_outdated(item.review_by),
    }

def to_datetime(value: date) -> datetime:
    return datetime.combine(value, time.min, tzinfo=timezone.utc)

def to_optional_datetime(value: date | None) -> datetime | None:
    return to_datetime(value) if value is not None else None

@router.get("", response_model=list[FactResponse])
def list_facts(db: DbSession, role: Annotated[str, Depends(get_role)]):
    return [to_response(item) for item in db.query(Fact).order_by(Fact.id).all()]

@router.post("", response_model=FactResponse, status_code=status.HTTP_201_CREATED)
def create_fact(
    payload: FactCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = Fact(
        statement=payload.claim,
        owner=payload.owner,
        source=payload.source,
        last_reviewed=to_optional_datetime(payload.lastReviewed),
        review_by=to_datetime(payload.reviewDate),
    )
    db.add(item)
    db.flush()
    record_knowledge_change(
        db, role, "created", "fact", item.id, item.statement
    )
    db.commit()
    db.refresh(item)
    return to_response(item)

@router.put("/{item_id}", response_model=FactResponse)
def update_fact(
    item_id: int,
    payload: FactCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Fact, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Fact not found")

    item.statement = payload.claim
    item.owner = payload.owner
    item.source = payload.source
    item.last_reviewed = to_optional_datetime(payload.lastReviewed)
    item.review_by = to_datetime(payload.reviewDate)
    record_knowledge_change(
        db, role, "updated", "fact", item.id, item.statement
    )
    db.commit()
    db.refresh(item)
    return to_response(item)

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fact(
    item_id: int,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Fact, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Fact not found")

    record_knowledge_change(
        db, role, "deleted", "fact", item.id, item.statement
    )
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
