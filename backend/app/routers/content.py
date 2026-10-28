from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import Content
from app.schemas import ContentDraft, ContentResponse

router = APIRouter(prefix="/content", tags=["content"])
DbSession = Annotated[Session, Depends(get_db)]


def _response(item: Content) -> ContentResponse:
    return ContentResponse.model_validate(item, from_attributes=True)


@router.get("/{content_id}", response_model=ContentResponse)
def get_content(
    content_id: int,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    item = db.get(Content, content_id)
    if item is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Content not found."})
    return _response(item)


@router.post("", response_model=ContentResponse, status_code=status.HTTP_201_CREATED)
def create_content(
    payload: ContentDraft,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    item = Content(title=payload.title, body=payload.body, created_by=role)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _response(item)


@router.put("/{content_id}", response_model=ContentResponse)
def update_content(
    content_id: int,
    payload: ContentDraft,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    item = db.get(Content, content_id)
    if item is None:
        raise HTTPException(status_code=404, detail={"error": "not_found", "message": "Content not found."})
    item.title = payload.title
    item.body = payload.body
    item.version += 1
    item.status = "draft"
    db.commit()
    db.refresh(item)
    return _response(item)
