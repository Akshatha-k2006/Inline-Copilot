from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

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


class FindingActionRequest(BaseModel):
    action: Literal["accept", "edit", "dismiss"]
    replacement: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_replacement(self) -> "FindingActionRequest":
        if self.action == "edit":
            if self.replacement is None or not self.replacement.strip():
                raise ValueError("An edit requires a non-empty replacement.")
        elif self.replacement is not None:
            raise ValueError("Replacement is only valid for the edit action.")
        return self


class FindingActionFindingResponse(BaseModel):
    id: int
    check: str
    severity: str
    message: str
    evidence: dict
    suggested_fix: str | None
    start_offset: int | None
    end_offset: int | None
    status: str


class FindingActionResponse(BaseModel):
    content_id: int
    content_version: int
    finding: FindingActionFindingResponse
