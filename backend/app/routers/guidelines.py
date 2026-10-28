from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role, require_writer
from app.models import Guideline, Term
from app.schemas import GuidelineCreate, GuidelineResponse
from app.services.audit import record_knowledge_change

router = APIRouter(prefix="/guidelines", tags=["guidelines"])

DbSession = Annotated[Session, Depends(get_db)]

@router.get("", response_model=list[GuidelineResponse])
def list_guidelines(db: DbSession, role: Annotated[str, Depends(get_role)]):
    return db.query(Guideline).order_by(Guideline.id).all()

@router.post("", response_model=GuidelineResponse, status_code=status.HTTP_201_CREATED)
def create_guideline(
    payload: GuidelineCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = Guideline(
        title=payload.title,
        description=payload.description,
        category=payload.category,
    )
    db.add(item)
    db.flush()
    record_knowledge_change(db, role, "created", "guideline", item.id, item.title)
    db.commit()
    db.refresh(item)
    return item

@router.put("/{item_id}", response_model=GuidelineResponse)
def update_guideline(
    item_id: int,
    payload: GuidelineCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Guideline, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Guideline not found")

    item.title = payload.title
    item.description = payload.description
    item.category = payload.category
    record_knowledge_change(db, role, "updated", "guideline", item.id, item.title)
    db.commit()
    db.refresh(item)
    return item

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_guideline(
    item_id: int,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Guideline, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Guideline not found")

    db.execute(
        update(Term)
        .where(Term.guideline_id == item.id)
        .values(guideline_id=None)
    )
    record_knowledge_change(db, role, "deleted", "guideline", item.id, item.title)
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
