from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

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


class ContentStatusResponse(BaseModel):
    content_id: int
    status: str
    content_version: int


class ContentCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    content_type: str = Field(min_length=1, max_length=100)
    body: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_content(self) -> "ContentCreateRequest":
        self.title = self.title.strip()
        self.content_type = self.content_type.strip()
        if not self.title or not self.content_type or not self.body.strip():
            raise ValueError("Title, content type, and body are required.")
        return self


class ContentUpdateRequest(ContentCreateRequest):
    version: int = Field(ge=1)


class ContentResponse(BaseModel):
    id: int
    title: str
    content_type: str
    body: str
    status: str
    version: int
    reviewed_version: int | None
    reviewed_at: datetime | None
    created_by: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AuditEventResponse(BaseModel):
    id: int
    content_id: int | None
    actor: str
    action: str
    details: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContentUpdate(BaseModel):
    title: str
    body: str

    model_config = ConfigDict(extra="forbid")


class ReviewDecisionRequest(BaseModel):
    decision: Literal["approve", "request_changes"]
    comment: str | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_comment(self) -> "ReviewDecisionRequest":
        if self.comment is not None:
            self.comment = self.comment.strip() or None
        if self.decision == "request_changes" and self.comment is None:
            raise ValueError("Requesting changes requires a non-empty comment.")
        return self


class ReviewCommentResponse(BaseModel):
    id: int
    author: str
    body: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReviewDecisionResponse(ContentStatusResponse):
    comment: ReviewCommentResponse | None


class ReviewCommentCreateRequest(BaseModel):
    body: str

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_body(self) -> "ReviewCommentCreateRequest":
        self.body = self.body.strip()
        if not self.body:
            raise ValueError("A comment body is required.")
        return self


class ContentCommentsResponse(BaseModel):
    content_id: int
    comments: list[ReviewCommentResponse]


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
