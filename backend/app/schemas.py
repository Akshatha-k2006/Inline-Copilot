from datetime import date, datetime
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

class ContentDraft(BaseModel):
    title: str
    body: str

class ContentResponse(ContentDraft):
    id: int
    status: str
    version: int
    created_by: str
    updated_at: datetime | None = None

class FindingAction(BaseModel):
    status: str
    final_text: str | None = None
