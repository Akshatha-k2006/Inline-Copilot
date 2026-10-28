
import json
import logging
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import AuditEvent, Content, Finding
from app.schemas import FindingActionRequest, FindingActionResponse
from app.services.terminology_checker import check_terminology
from app.services.fact_checker import check_claims
from app.services.tone_checker import check_tone
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
REVIEW_CHECKS = (
    "terminology",
    "tone",
    "messaging",
    "unsupported_claim",
    "outdated_info",
)


def _action_error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": code, "message": message},
    )


def _finding_action_response(
    content: Content,
    finding: Finding,
) -> dict:
    return {
        "content_id": content.id,
        "content_version": content.version,
        "finding": {
            "id": finding.id,
            "check": finding.check_type,
            "severity": finding.severity,
            "message": finding.message,
            "evidence": finding.evidence,
            "suggested_fix": finding.suggested_fix,
            "start_offset": finding.start_offset,
            "end_offset": finding.end_offset,
            "status": finding.status,
        },
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
def review_content(
    content_id: int,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
):
    try:
        content = (
            db.query(Content)
            .filter(Content.id == content_id)
            .with_for_update()
            .first()
        )
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
    if role != "creator" or content.created_by != x_user.strip().rsplit(" (", 1)[0]:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "Only the content's creator can run its review.",
            },
        )
    if content.status != "draft":
        raise HTTPException(
            status_code=409,
            detail={
                "error": "invalid_status_transition",
                "message": "Only draft content can be reviewed.",
            },
        )

    try:
        # Replace only open findings for this exact reviewed version.
        db.query(Finding).filter(
            Finding.content_id == content_id,
            Finding.content_version == content.version,
            Finding.status == "open",
            Finding.check_type.in_(REVIEW_CHECKS),
        ).delete(synchronize_session=False)

        terminology_findings = check_terminology(content.body, db)
        claim_findings = check_claims(content.body, db)
        tone_findings = check_tone(content.body, db)

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
        rule_findings = terminology_findings + claim_findings + tone_findings
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

        content.reviewed_version = content.version
        content.reviewed_at = datetime.now(timezone.utc)
        db.add(
            AuditEvent(
                content_id=content.id,
                actor=x_user.strip(),
                action="content_reviewed",
                details={
                    "actor_role": role,
                    "content_version": content.version,
                    "finding_count": len(saved_findings),
                    "engine": {"rules": "ok", "llm": llm_status},
                },
            )
        )
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
    except Exception:
        db.rollback()
        raise

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


@router.patch(
    "/findings/{finding_id}",
    response_model=FindingActionResponse,
)
def update_finding(
    finding_id: int,
    action_request: FindingActionRequest,
    x_user: Annotated[str, Header()],
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
):
    actor = x_user.strip()
    if not actor:
        raise _action_error(
            422,
            "validation_error",
            "The request data is invalid.",
        )

    try:
        finding = (
            db.query(Finding)
            .filter(Finding.id == finding_id)
            .first()
        )
        if finding is None:
            raise _action_error(404, "not_found", "Finding not found.")

        content = (
            db.query(Content)
            .filter(Content.id == finding.content_id)
            .with_for_update()
            .first()
        )
        if content is None:
            raise _action_error(404, "not_found", "Content not found.")
        if (
            role != "creator"
            or content.created_by != actor.rsplit(" (", 1)[0]
            or content.status != "draft"
        ):
            raise _action_error(
                403,
                "forbidden",
                "Only the content's creator can update findings on a draft.",
            )

        finding = (
            db.query(Finding)
            .filter(Finding.id == finding_id)
            .with_for_update()
            .populate_existing()
            .first()
        )
        if finding is None:
            raise _action_error(404, "not_found", "Finding not found.")
        if finding.status != "open":
            raise _action_error(
                409,
                "finding_resolved",
                "Only open findings can be updated.",
            )
        if finding.content_version != content.version:
            raise _action_error(
                409,
                "stale_finding",
                "The finding belongs to an older content version.",
            )

        start = finding.start_offset
        end = finding.end_offset
        matched_text = (
            finding.evidence.get("matched_text")
            if isinstance(finding.evidence, dict)
            else None
        )
        if (
            not isinstance(start, int)
            or isinstance(start, bool)
            or not isinstance(end, int)
            or isinstance(end, bool)
            or not isinstance(matched_text, str)
            or start < 0
            or start >= end
            or end > len(content.body)
            or content.body[start:end] != matched_text
        ):
            raise _action_error(
                409,
                "stale_finding",
                "The finding text no longer matches the content.",
            )

        action = action_request.action
        old_version = content.version
        previous_text = matched_text
        replacement = None
        if action == "accept":
            replacement = finding.suggested_fix
            if replacement is None:
                raise _action_error(
                    409,
                    "suggestion_unavailable",
                    "This finding has no suggested fix to accept.",
                )
        elif action == "edit":
            replacement = action_request.replacement

        replacement_action = action in {"accept", "edit"}
        changes_content = (
            replacement_action and replacement != matched_text
        )
        new_version = old_version
        if changes_content:
            replacement = replacement or ""
            delta = len(replacement) - (end - start)
            affected_findings = (
                db.query(Finding)
                .filter(
                    Finding.content_id == content.id,
                    Finding.content_version == old_version,
                    Finding.id != finding.id,
                )
                .with_for_update()
                .all()
            )
            original_body = content.body
            for other in affected_findings:
                other_start = other.start_offset
                other_end = other.end_offset
                if other_start is None and other_end is None:
                    continue
                if (
                    not isinstance(other_start, int)
                    or isinstance(other_start, bool)
                    or not isinstance(other_end, int)
                    or isinstance(other_end, bool)
                    or other_start < 0
                    or other_start >= other_end
                    or other_end > len(original_body)
                ):
                    continue
                if other_start < end and other_end > start:
                    raise _action_error(
                        409,
                        "overlapping_finding",
                        "The replacement overlaps another finding; review the text before applying it.",
                    )
                other_text = (
                    other.evidence.get("matched_text")
                    if isinstance(other.evidence, dict)
                    else None
                )
                if (
                    not isinstance(other_text, str)
                    or content.body[other_start:other_end] != other_text
                ):
                    continue

            updated_body = (
                original_body[:start] + replacement + original_body[end:]
            )
            updated_version = old_version + 1
            update_result = db.execute(
                update(Content)
                .where(
                    Content.id == content.id,
                    Content.version == old_version,
                )
                .values(
                    body=updated_body,
                    version=updated_version,
                    reviewed_version=None,
                    reviewed_at=None,
                )
            )
            if update_result.rowcount != 1:
                raise _action_error(
                    409,
                    "stale_finding",
                    "The content changed while this action was being applied.",
                )
            db.refresh(content)
            new_version = content.version

            for other in affected_findings:
                other_start = other.start_offset
                other_end = other.end_offset
                if (
                    not isinstance(other_start, int)
                    or isinstance(other_start, bool)
                    or not isinstance(other_end, int)
                    or isinstance(other_end, bool)
                    or other_start < 0
                    or other_start >= other_end
                    or other_end > len(original_body)
                ):
                    continue
                other_text = (
                    other.evidence.get("matched_text")
                    if isinstance(other.evidence, dict)
                    else None
                )
                if (
                    not isinstance(other_text, str)
                    or original_body[other_start:other_end] != other_text
                ):
                    continue

                updated_start = (
                    other_start + delta if other_start >= end else other_start
                )
                updated_end = other_end + delta if other_start >= end else other_end
                if updated_body[updated_start:updated_end] != other_text:
                    continue
                other.start_offset = updated_start
                other.end_offset = updated_end
                other.content_version = new_version

            finding.end_offset = start + len(replacement)
            finding.content_version = new_version
            finding.evidence = {
                **finding.evidence,
                "matched_text": replacement,
            }
            finding.status = "accepted" if action == "accept" else "edited"
        elif replacement_action:
            finding.status = "accepted" if action == "accept" else "edited"
        else:
            finding.status = "dismissed"

        action_name = {
            "accept": "finding_accepted",
            "edit": "finding_edited",
            "dismiss": "finding_dismissed",
        }[action]
        details = {
            "finding_id": finding.id,
            "action": action,
            "previous_status": "open",
            "new_status": finding.status,
            "previous_version": old_version,
            "new_version": new_version,
        }
        if changes_content:
            details["changes"] = {
                "field": "text",
                "previous": previous_text,
                "next": replacement,
            }
        db.add(
            AuditEvent(
                content_id=content.id,
                actor=actor,
                action=action_name,
                details=details,
            )
        )
        response = _finding_action_response(content, finding)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Unable to update finding.")
        raise _action_error(
            500,
            "review_failed",
            "Unable to save finding action.",
        ) from exc
    except Exception:
        db.rollback()
        raise

    return response
