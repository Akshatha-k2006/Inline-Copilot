from datetime import date
from pydantic import BaseModel, ConfigDict

class GuidelineCreate(BaseModel):
    title: str
    description: str

class GuidelineResponse(GuidelineCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class TermCreate(BaseModel):
    term: str
    definition: str
    preferredTerm: str | None = None

class TermResponse(TermCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class FactCreate(BaseModel):
    claim: str
    owner: str
    reviewDate: date

class FactResponse(FactCreate):
    id: int
    outdated: bool

class AssetCreate(BaseModel):
    name: str
    description: str
    url: str | None = None

class AssetResponse(AssetCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)
