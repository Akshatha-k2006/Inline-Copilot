from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role, require_writer
from app.models import Term
from app.schemas import TermCreate, TermResponse

router = APIRouter(prefix="/glossary", tags=["glossary"])

DbSession = Annotated[Session, Depends(get_db)]

def to_response(item: Term) -> dict:
    return {
        "id": item.id,
        "term": item.term,
        "definition": item.definition,
        "preferredTerm": item.replacement,
        "status": item.status,
        "guidelineId": None,
    }

@router.get("", response_model=list[TermResponse])
def list_terms(db: DbSession, role: Annotated[str, Depends(get_role)]):
    return [to_response(item) for item in db.query(Term).order_by(Term.id).all()]

@router.post("", response_model=TermResponse, status_code=status.HTTP_201_CREATED)
def create_term(
    payload: TermCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = Term(
        term=payload.term,
        definition=payload.definition,
        replacement=payload.preferredTerm,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return to_response(item)

@router.put("/{item_id}", response_model=TermResponse)
def update_term(
    item_id: int,
    payload: TermCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Term, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    item.term = payload.term
    item.definition = payload.definition
    item.replacement = payload.preferredTerm
    db.commit()
    db.refresh(item)
    return to_response(item)

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_term(
    item_id: int,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Term, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Glossary term not found")

    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)