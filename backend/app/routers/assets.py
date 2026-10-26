from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role, require_writer
from app.models import Asset
from app.schemas import AssetCreate, AssetResponse

router = APIRouter(prefix="/assets", tags=["assets"])

DbSession = Annotated[Session, Depends(get_db)]

def to_response(item: Asset) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "description": item.description,
        "url": item.url or None,
    }

@router.get("", response_model=list[AssetResponse])
def list_assets(db: DbSession, role: Annotated[str, Depends(get_role)]):
    return [to_response(item) for item in db.query(Asset).order_by(Asset.id).all()]

@router.post("", response_model=AssetResponse, status_code=status.HTTP_201_CREATED)
def create_asset(
    payload: AssetCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = Asset(
        name=payload.name,
        description=payload.description,
        url=payload.url or "",
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return to_response(item)

@router.put("/{item_id}", response_model=AssetResponse)
def update_asset(
    item_id: int,
    payload: AssetCreate,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Asset, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    item.name = payload.name
    item.description = payload.description
    item.url = payload.url or ""
    db.commit()
    db.refresh(item)
    return to_response(item)

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    item_id: int,
    db: DbSession,
    role: Annotated[str, Depends(require_writer)],
):
    item = db.get(Asset, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Asset not found")

    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
