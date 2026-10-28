
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Content, Finding
from app.schemas import FindingAction
from app.services.terminology_checker import check_terminology
from app.services.fact_checker import check_claims
from app.config import settings
from app.services.llm_reviewer import (
    LLMProviderError,
    LLMResponseError,
    LLMTimeoutError,
    LLMTransportError,
    review_with_llm,
)
from app.services.suggestion_generator import generate_suggestions

router = APIRouter(tags=["Review"])
logger = logging.getLogger(__name__)


def _finding_response(finding: Finding) -> dict:
    evidence = finding.evidence or {}
    source = evidence.get("source") or {}
    source_type = source.get("type")
    if source_type == "glossary":
        source_type = "term"
    source_id = source.get("id")
    source_label = source.get("label") or source.get("text")
    if not source_label and source_type == "term":
        source_label = f"{source.get('term', '')} -> {source.get('preferred_term', '')}".strip(" ->")
    return {
        "id": finding.id,
        "content_id": finding.content_id,
        "check": finding.check_type,
        "severity": finding.severity if finding.severity in {"high", "medium", "low"} else "medium",
        "message": finding.message,
        "explanation": source.get("explanation") or finding.message,
        "evidence": evidence,
        "start": finding.start_offset,
        "end": finding.end_offset,
        "start_offset": finding.start_offset,
        "end_offset": finding.end_offset,
        "text": evidence.get("matched_text", ""),
        "source": (
            {
                "type": source_type,
                "id": source_id,
                "label": source_label or "",
            }
            if source_type in {"term", "guideline", "fact"} and source_id is not None
            else None
        ),
        "suggestion": finding.suggested_fix,
        "suggested_fix": finding.suggested_fix,
        "status": finding.status,
        "final_text": evidence.get("final_text"),
    }


def _is_duplicate(existing: dict, candidate: dict) -> bool:
    if existing["check"] != candidate["check"]:
        return False

    existing_start = existing["start_offset"]
    existing_end = existing["end_offset"]
    candidate_start = candidate["start_offset"]
    candidate_end = candidate["end_offset"]
    if None in (existing_start, existing_end, candidate_start, candidate_end):
        return False

    shorter_length = min(
        existing_end - existing_start,
        candidate_end - candidate_start,
    )
    overlap = max(
        0,
        min(existing_end, candidate_end) - max(existing_start, candidate_start),
    )
    return shorter_length > 0 and overlap / shorter_length >= 0.5


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
    
    # Remove previous findings from all checks handled by this review.
    db.query(Finding).filter(
        Finding.content_id == content_id,
        Finding.check_type.in_([
            "terminology",
            "tone",
            "messaging",
            "unsupported_claim",
            "outdated_info",
        ]),
    ).delete(synchronize_session=False)


    terminology_findings = check_terminology(content.body, db)
    claim_findings = check_claims(content.body, db)

    llm_status = "ok"
    try:
        llm_findings = review_with_llm(content.body, db)
    except LLMTimeoutError:
        llm_findings = []
        llm_status = "timeout"
        logger.warning("Hosted LLM review failed: category=timeout")
    except LLMProviderError as exc:
        llm_findings = []
        llm_status = "error"
        logger.warning(
            "Hosted LLM review failed: category=provider status=%d reason=%s",
            exc.status_code,
            exc.category,
        )
    except LLMTransportError:
        llm_findings = []
        llm_status = "error"
        logger.warning("Hosted LLM review failed: category=transport")
    except LLMResponseError as exc:
        llm_findings = []
        llm_status = "error"
        logger.warning("Hosted LLM review failed: category=%s", exc.category)
    except Exception:
        llm_findings = []
        llm_status = "error"
        logger.warning("Hosted LLM review failed: category=unexpected")

    saved_findings = []
    rule_findings = terminology_findings + claim_findings
    all_findings = rule_findings.copy()
    for llm_finding in llm_findings:
        duplicate = any(
            _is_duplicate(existing, llm_finding)
            for existing in all_findings
        )
        if not duplicate:
            all_findings.append(llm_finding)

    all_findings = generate_suggestions(content.body, all_findings)

    for item in all_findings:
        evidence = {
            "matched_text": item["matched_text"],
            "source": item["source"],
            "requires_manual_review": (item.get("evidence") or {}).get(
                "requires_manual_review",
                item["suggested_fix"] is None,
            ),
        }
        source = item.get("source") or {}
        if source.get("type") == "glossary":
            source["type"] = "term"
        evidence["source"] = source
        if item.get("suggestion_source"):
            evidence["suggestion_source"] = item["suggestion_source"]

        finding = Finding(
            content_id=content.id,
            check_type=item["check"],
            severity=item["severity"],
            message=item["message"],
            evidence=evidence,
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
        "findings": [_finding_response(finding) for finding in saved_findings],
        "engine": {
            "rules": "ok",
            "llm": (
                "disabled"
                if llm_status == "ok" and not settings.llm_api_key
                else llm_status
            ),
        },
    }


@router.patch("/findings/{finding_id}")
def update_finding(
    finding_id: int,
    payload: FindingAction,
    db: Session = Depends(get_db),
):
    if payload.status not in {"accepted", "edited", "dismissed"}:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_status", "message": "Finding status is invalid."},
        )
    finding = db.get(Finding, finding_id)
    if finding is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "not_found", "message": "Finding not found."},
        )
    finding.status = payload.status
    evidence = dict(finding.evidence or {})
    if payload.final_text is not None:
        evidence["final_text"] = payload.final_text
    finding.evidence = evidence
    db.commit()
    db.refresh(finding)
    return _finding_response(finding)
