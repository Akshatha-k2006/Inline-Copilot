
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Content, Finding
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


def _finding_sort_key(finding: dict) -> tuple:
    start = finding["start_offset"]
    end = finding["end_offset"]
    return (
        start is None,
        start if start is not None else 0,
        end is None,
        end if end is not None else 0,
        finding["check"],
        finding["severity"],
        finding["message"],
        json.dumps(finding["source"], sort_keys=True, separators=(",", ":")),
        json.dumps(
            finding.get("suggestion_source"),
            sort_keys=True,
            separators=(",", ":"),
        ),
        finding["suggested_fix"] or "",
    )


@router.post("/content/{content_id}/review")
def review_content(content_id: int, db: Session = Depends(get_db)):
    try:
        content = db.get(Content, content_id)
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to load content for review.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "review_failed",
                "message": "Unable to save review findings.",
            },
        ) from exc

    if content is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "not_found",
                "message": "Content not found.",
            },
        )

    try:
        # Replace prior results for the checks handled by this review in the
        # same transaction as writing their replacements.
        db.query(Finding).filter(
            Finding.content_id == content_id,
            Finding.check_type.in_(
                [
                    "terminology",
                    "tone",
                    "messaging",
                    "unsupported_claim",
                    "outdated_info",
                ]
            ),
        ).delete(synchronize_session=False)

        terminology_findings = check_terminology(content.body, db)
        claim_findings = check_claims(content.body, db)

        llm_status = "ok"
        try:
            llm_findings = review_with_llm(content.body, db)
        except SQLAlchemyError:
            raise
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
        all_findings.sort(key=_finding_sort_key)

        for item in all_findings:
            evidence = {
                "matched_text": item["matched_text"],
                "source": item["source"],
                "requires_manual_review": item["evidence"].get(
                    "requires_manual_review",
                    item["suggested_fix"] is None,
                ),
            }
            if item.get("suggestion_source"):
                evidence["suggestion_source"] = item["suggestion_source"]

            finding = Finding(
                content_id=content.id,
                content_version=content.version,
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

        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to save review findings.")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "review_failed",
                "message": "Unable to save review findings.",
            },
        ) from exc

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
        "engine": {
            "rules": "ok",
            "llm": (
                "disabled"
                if llm_status == "ok" and not settings.llm_api_key
                else llm_status
            ),
        },
    }
