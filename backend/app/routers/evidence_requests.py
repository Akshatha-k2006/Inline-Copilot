from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import AuditEvent, EvidenceRequest, Finding
from app.schemas import (
    EVIDENCE_REQUEST_ASSIGNEES,
    EVIDENCE_REQUEST_STATUSES,
    EvidenceRequestAttach,
    EvidenceRequestCreate,
    EvidenceActivityResponse,
    EvidenceDecision,
    EvidenceRequestResponse,
)

router = APIRouter(prefix="/evidence-requests", tags=["Evidence requests"])

DbSession = Annotated[Session, Depends(get_db)]


def _error(code: int, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=code, detail={"error": error, "message": message}
    )


def to_response(item: EvidenceRequest) -> dict:
    return {
        "id": item.id,
        "claimText": item.claim_text,
        "findingId": item.finding_id,
        "reason": item.reason,
        "assignee": item.assignee,
        "status": item.status,
        "createdAt": item.created_at,
        "updatedAt": item.updated_at,
        "sourceType": item.source_type,
        "sourceUrl": item.source_url,
        "documentName": item.document_name,
        "documentType": item.document_type,
        "evidenceDescription": item.evidence_description,
        "ownerExplanation": item.owner_explanation,
        "attachedBy": item.attached_by,
        "attachedAt": item.attached_at,
        "verifiedBy": item.verified_by,
        "verifiedAt": item.verified_at,
        "decision": item.decision,
        "reviewerFeedback": item.reviewer_feedback,
        "decidedBy": item.decided_by,
        "decidedAt": item.decided_at,
    }


@router.get("", response_model=list[EvidenceRequestResponse])
def list_evidence_requests(
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
    status_filter: str | None = Query(default=None, alias="status"),
    assignee: str | None = Query(default=None),
    finding_id: int | None = Query(default=None, alias="findingId"),
):
    if status_filter is not None and status_filter not in EVIDENCE_REQUEST_STATUSES:
        raise _error(422, "validation_error", "Unknown evidence request status.")

    query = db.query(EvidenceRequest)
    if status_filter is not None:
        query = query.where(EvidenceRequest.status == status_filter)
    if assignee is not None:
        query = query.where(EvidenceRequest.assignee == assignee)
    if finding_id is not None:
        query = query.where(EvidenceRequest.finding_id == finding_id)

    items = query.order_by(EvidenceRequest.id).all()
    return [to_response(item) for item in items]


@router.post(
    "", response_model=EvidenceRequestResponse, status_code=status.HTTP_201_CREATED
)
def create_evidence_request(
    payload: EvidenceRequestCreate,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    finding = db.get(Finding, payload.findingId)
    if finding is None:
        raise _error(404, "not_found", "Finding not found")
    if finding.check_type != "unsupported_claim":
        raise _error(
            422,
            "validation_error",
            "Evidence requests are only supported for unsupported_claim findings.",
        )
    evidence = finding.evidence if isinstance(finding.evidence, dict) else {}
    matched_text = evidence.get("matched_text")
    if isinstance(matched_text, str) and matched_text.strip():
        if payload.claimText != matched_text.strip():
            raise _error(
                422,
                "validation_error",
                "Claim text must match the unsupported claim finding.",
            )
    if payload.assignee not in EVIDENCE_REQUEST_ASSIGNEES:
        raise _error(422, "validation_error", "Assigned owner is not valid.")

    item = EvidenceRequest(
        finding_id=finding.id,
        claim_text=payload.claimText,
        reason=payload.reason,
        assignee=payload.assignee,
        status="open",
    )
    db.add(item)
    db.flush()
    db.add(
        AuditEvent(
            actor=role,
            action="evidence_request_created",
            content_id=None,
            details={
                "actor_role": role,
                "finding_id": finding.id,
                "assignee": payload.assignee,
                "evidence_request_id": item.id,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return to_response(item)


@router.post("/{request_id}/verify", response_model=EvidenceRequestResponse)
def verify_evidence_request(
    request_id: int,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    item = db.get(EvidenceRequest, request_id)
    if item is None:
        raise _error(404, "not_found", "Evidence request not found")
    if role != "reviewer":
        raise _error(403, "forbidden", "Only Reviewers can verify evidence requests.")
    if item.status != "open":
        raise _error(
            409, "conflict", "Only open evidence requests can be verified."
        )
    if item.source_type is None:
        raise _error(
            409, "conflict", "The evidence request has no attached evidence."
        )

    item.status = "fulfilled"
    item.verified_by = role
    item.verified_at = func.now()
    db.add(
        AuditEvent(
            actor=role,
            action="evidence_request_verified",
            content_id=None,
            details={
                "evidence_request_id": item.id,
                "source_type": item.source_type,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return to_response(item)


@router.post("/{request_id}/evidence", response_model=EvidenceRequestResponse)
def attach_evidence(
    request_id: int,
    payload: EvidenceRequestAttach,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
    x_user: Annotated[str | None, Header()] = None,
):
    item = db.get(EvidenceRequest, request_id)
    if item is None:
        raise _error(404, "not_found", "Evidence request not found")
    if item.status != "open":
        raise _error(
            409,
            "conflict",
            "Evidence can only be attached to an open evidence request.",
        )
    actor = (x_user or "").strip()
    if role == "creator" and actor not in {item.assignee, item.assignee.split(" (")[0]}:
        raise _error(403, "forbidden", "Only the assigned owner can submit evidence.")

    item.source_type = payload.sourceType
    item.source_url = payload.sourceUrl
    item.document_name = payload.documentName
    item.document_type = payload.documentType
    item.evidence_description = payload.evidenceDescription
    item.owner_explanation = payload.ownerExplanation
    item.attached_by = actor or role
    item.attached_at = func.now()

    db.add(
        AuditEvent(
            actor=role,
            action="evidence_request_attached",
            content_id=None,
            details={
                "evidence_request_id": item.id,
                "source_type": payload.sourceType,
                "assignee": item.assignee,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return to_response(item)


def _reviewer_only(role: str) -> None:
    if role not in {"reviewer", "admin", "brand_manager"}:
        raise _error(403, "forbidden", "Only authorised reviewers can decide evidence.")


@router.get("/{request_id}", response_model=EvidenceRequestResponse)
def get_evidence_request(request_id: int, db: DbSession):
    item = db.get(EvidenceRequest, request_id)
    if item is None:
        raise _error(404, "not_found", "Evidence request not found")
    return to_response(item)


@router.get(
    "/{request_id}/activity",
    response_model=list[EvidenceActivityResponse],
)
def list_evidence_activity(request_id: int, db: DbSession):
    if db.get(EvidenceRequest, request_id) is None:
        raise _error(404, "not_found", "Evidence request not found")
    events = (
        db.query(AuditEvent)
        .filter(AuditEvent.details["evidence_request_id"].as_integer() == request_id)
        .order_by(AuditEvent.created_at.asc(), AuditEvent.id.asc())
        .all()
    )
    return [
        {
            "id": event.id,
            "eventType": event.action,
            "actor": event.actor,
            "timestamp": event.created_at,
            "details": event.details,
        }
        for event in events
    ]


@router.post(
    "/{request_id}/approve",
    response_model=EvidenceRequestResponse,
)
def approve_evidence_request(
    request_id: int,
    payload: EvidenceDecision,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    _reviewer_only(role)
    item = db.get(EvidenceRequest, request_id)
    if item is None:
        raise _error(404, "not_found", "Evidence request not found")
    if item.status != "open" or item.decision is not None:
        raise _error(409, "conflict", "This evidence request already has a final decision.")
    if item.source_type is None:
        raise _error(409, "conflict", "Evidence must be submitted before approval.")
    item.status = "fulfilled"
    item.decision = "approved"
    item.reviewer_feedback = payload.feedback
    item.decided_by = role
    item.decided_at = func.now()
    item.verified_by = role
    item.verified_at = func.now()
    db.add(
        AuditEvent(
            actor=role,
            action="evidence_request_approved",
            content_id=None,
            details={
                "evidence_request_id": item.id,
                "feedback": payload.feedback,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return to_response(item)


@router.post(
    "/{request_id}/reject",
    response_model=EvidenceRequestResponse,
)
def reject_evidence_request(
    request_id: int,
    payload: EvidenceDecision,
    db: DbSession,
    role: Annotated[str, Depends(get_role)],
):
    _reviewer_only(role)
    item = db.get(EvidenceRequest, request_id)
    if item is None:
        raise _error(404, "not_found", "Evidence request not found")
    if item.status != "open" or item.decision is not None:
        raise _error(409, "conflict", "This evidence request already has a final decision.")
    if item.source_type is None:
        raise _error(409, "conflict", "Evidence must be submitted before rejection.")
    item.status = "dismissed"
    item.decision = "rejected"
    item.reviewer_feedback = payload.feedback
    item.decided_by = role
    item.decided_at = func.now()
    db.add(
        AuditEvent(
            actor=role,
            action="evidence_request_rejected",
            content_id=None,
            details={
                "evidence_request_id": item.id,
                "feedback": payload.feedback,
            },
        )
    )
    db.commit()
    db.refresh(item)
    return to_response(item)
