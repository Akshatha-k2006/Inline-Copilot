from datetime import date, datetime
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, model_validator

class GuidelineCreate(BaseModel):
    title: str
    description: str
    category: str = "general"

class GuidelineResponse(GuidelineCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class TermCreate(BaseModel):
    term: str
    definition: str
    preferredTerm: str | None = None
    status: Literal["approved", "prohibited"] = "prohibited"
    guidelineId: int | None = None

class TermResponse(TermCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)

class FactCreate(BaseModel):
    claim: str
    owner: str
    reviewDate: date
    source: str = ""
    lastReviewed: date | None = None


class FactReapproveRequest(BaseModel):
    reviewDate: date
    lastReviewed: date | None = None

class FactResponse(FactCreate):
    reviewDate: date | None
    id: int
    outdated: bool

class AssetCreate(BaseModel):
    name: str
    description: str
    url: str | None = None
    assetType: str = "other"

class AssetResponse(AssetCreate):
    id: int
    model_config = ConfigDict(from_attributes=True)


class ContrastCheckRequest(BaseModel):
    foreground_color: str = Field(pattern=r"^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")
    background_color: str = Field(pattern=r"^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$")
    text_size: Literal["normal", "large"] = "normal"

    model_config = ConfigDict(extra="forbid")


class ContentStatusResponse(BaseModel):
    content_id: int
    status: str
    content_version: int


class ContentCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    content_type: str = Field(min_length=1, max_length=100)
    # A new draft can be empty; the editor supplies its own placeholder text.
    body: str = ""
    foreground_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$")
    background_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$")
    text_size: Literal["normal", "large"] | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_content(self) -> "ContentCreateRequest":
        self.title = self.title.strip()
        self.content_type = self.content_type.strip()
        if not self.title or not self.content_type:
            raise ValueError("Title and content type are required.")
        return self


class ContentUpdateRequest(ContentCreateRequest):
    version: int = Field(ge=1)


class ContentResponse(BaseModel):
    id: int
    title: str
    content_type: str
    body: str
    foreground_color: str | None
    background_color: str | None
    text_size: Literal["normal", "large"] | None
    status: str
    version: int
    reviewed_version: int | None
    reviewed_at: datetime | None
    created_by: str
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContentImageResponse(BaseModel):
    id: int
    content_id: int
    filename: str
    mime_type: str
    alt_text: str
    url: str
    created_at: datetime
    updated_at: datetime


class ContentImageAltTextRequest(BaseModel):
    alt_text: str = Field(max_length=1000)

    model_config = ConfigDict(extra="forbid")


class AuditEventResponse(BaseModel):
    id: int
    content_id: int | None
    actor: str
    action: str
    details: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


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


EVIDENCE_REQUEST_STATUSES: tuple[str, ...] = ("open", "fulfilled", "dismissed")
EVIDENCE_REQUEST_ASSIGNEES: tuple[str, ...] = (
    "Asha (Creator)",
    "Ravi (Reviewer)",
    "Bhavana (Brand Manager)",
    "Admin",
)

SUPPORTED_DOCUMENT_TYPES: tuple[str, ...] = (
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "png",
    "jpg",
    "jpeg",
    "webp",
)


class EvidenceRequestCreate(BaseModel):
    claimText: str = Field(min_length=1)
    findingId: int
    reason: str = Field(min_length=1)
    assignee: str = Field(min_length=1, max_length=150)

    @model_validator(mode="after")
    def strip_fields(self) -> "EvidenceRequestCreate":
        self.claimText = self.claimText.strip()
        self.reason = self.reason.strip()
        self.assignee = self.assignee.strip()
        for field in ("claimText", "reason", "assignee"):
            if not getattr(self, field):
                raise ValueError(f"{field} must not be blank.")
        return self


class EvidenceRequestAttach(BaseModel):
    sourceType: Literal["url", "document"]
    sourceUrl: str | None = None
    documentName: str | None = None
    documentType: str | None = None
    evidenceDescription: str = Field(default="Evidence source", max_length=1000)
    ownerExplanation: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def validate_source(self) -> "EvidenceRequestAttach":
        self.sourceUrl = self.sourceUrl.strip() if self.sourceUrl else None
        self.documentName = (
            self.documentName.strip() if self.documentName else None
        )
        self.documentType = (
            self.documentType.strip() if self.documentType else None
        )
        self.evidenceDescription = self.evidenceDescription.strip()
        self.ownerExplanation = (
            self.ownerExplanation.strip() if self.ownerExplanation else None
        )
        if not self.evidenceDescription:
            raise ValueError("evidenceDescription must not be blank.")
        if self.sourceType == "url":
            if not self.sourceUrl:
                raise ValueError("sourceUrl is required for a url source.")
            parsed = urlparse(self.sourceUrl)
            if parsed.scheme not in ("http", "https") or not parsed.netloc:
                raise ValueError("sourceUrl must be a valid http(s) URL.")
            if self.documentName is not None or self.documentType is not None:
                raise ValueError(
                    "documentName and documentType are only valid for a "
                    "document source."
                )
        else:
            if self.sourceUrl is not None:
                raise ValueError("sourceUrl is only valid for a url source.")
            if not self.documentName:
                raise ValueError(
                    "documentName is required for a document source."
                )
            if not self.documentType:
                raise ValueError(
                    "documentType is required for a document source."
                )
            if self.documentType not in SUPPORTED_DOCUMENT_TYPES:
                raise ValueError(
                    "documentType must be one of: "
                    + ", ".join(SUPPORTED_DOCUMENT_TYPES)
                    + "."
                )
            self.sourceUrl = None
        return self


class EvidenceRequestResponse(BaseModel):
    id: int
    claimText: str
    findingId: int
    reason: str
    assignee: str
    status: str
    createdAt: datetime
    updatedAt: datetime
    sourceType: str | None
    sourceUrl: str | None
    documentName: str | None
    documentType: str | None
    evidenceDescription: str | None
    ownerExplanation: str | None
    attachedBy: str | None
    attachedAt: datetime | None
    verifiedBy: str | None
    verifiedAt: datetime | None
    decision: str | None
    reviewerFeedback: str | None
    decidedBy: str | None
    decidedAt: datetime | None


class EvidenceDecision(BaseModel):
    feedback: str = Field(min_length=1, max_length=2000)

    @model_validator(mode="after")
    def strip_feedback(self) -> "EvidenceDecision":
        self.feedback = self.feedback.strip()
        if not self.feedback:
            raise ValueError("feedback must not be blank.")
        return self


class EvidenceActivityResponse(BaseModel):
    id: int
    eventType: str
    actor: str
    timestamp: datetime
    details: dict
