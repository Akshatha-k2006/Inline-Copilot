from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import Asset, Fact, Guideline, Term
from app.routers.assets import to_response as asset_response
from app.routers.facts import to_response as fact_response
from app.routers.glossary import to_response as term_response

router = APIRouter(prefix="/brand", tags=["brand"])


@router.get("")
def get_brand(
    db: Annotated[Session, Depends(get_db)],
    role: Annotated[str, Depends(get_role)],
):
    return {
        "brand": "Lumina Home",
        "guidelines": [
            {
                "id": item.id,
                "title": item.title,
                "description": item.description,
                "kind": item.category,
            }
            for item in db.query(Guideline).order_by(Guideline.id)
        ],
        "glossary": [term_response(item) for item in db.query(Term).order_by(Term.id)],
        "facts": [fact_response(item) for item in db.query(Fact).order_by(Fact.id)],
        "assets": [asset_response(item) for item in db.query(Asset).order_by(Asset.id)],
    }
