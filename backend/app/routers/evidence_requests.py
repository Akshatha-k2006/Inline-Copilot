from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import AuditEvent, EvidenceRequest, Finding
from app.schemas import EvidenceRequestCreate, EvidenceRequestResponse

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
    }


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
