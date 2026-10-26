
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Content, Finding
from app.services.terminology_checker import check_terminology

router = APIRouter(tags=["Review"])


@router.post("/content/{content_id}/review")
def review_content(content_id: int, db: Session = Depends(get_db)):
    content = db.get(Content, content_id)

    if content is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": "Content not found.",
            },
        )

    # Remove previous terminology findings so every review
    # reflects the current glossary and current draft.
    db.query(Finding).filter(
        Finding.content_id == content_id,
        Finding.check_type == "terminology",
    ).delete(synchronize_session=False)

    terminology_findings = check_terminology(content.body, db)

    saved_findings = []

    for item in terminology_findings:
        finding = Finding(
            content_id=content.id,
            check_type="terminology",
            severity=item["severity"],
            message=item["message"],
            evidence={
                "matched_text": item["matched_text"],
                "source": item["source"],
            },
            suggested_fix=item["suggested_fix"],
            start_offset=item["start_offset"],
            end_offset=item["end_offset"],
            status="open",
        )
        db.add(finding)
        saved_findings.append(finding)

    try:
        db.commit()
        for finding in saved_findings:
            db.refresh(finding)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail={
                "error": "review_failed",
                "message": "Unable to save review findings.",
            },
        )

    return {
        "content_id": content.id,
        "content_version": content.version,
        "findings": [
            {
                "id": finding.id,
                "check": finding.check_type,
                "severity": finding.severity,
                "message": finding.message,
                "evidence": finding.evidence,
                "suggested_fix": finding.suggested_fix,
                "start_offset": finding.start_offset,
                "end_offset": finding.end_offset,
                "status": finding.status,
            }
            for finding in saved_findings
        ],
    }
