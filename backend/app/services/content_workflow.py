from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import AuditEvent, Comment, Content, Finding

TRANSITION_ROLES = {
    ("draft", "self_checked"): {"creator"},
    ("self_checked", "in_review"): {"creator"},
    ("in_review", "approved"): {"reviewer"},
    ("in_review", "draft"): {"reviewer"},
    ("approved", "ready_to_publish"): {"brand_manager", "admin"},
}


def _workflow_error(status_code: int, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": error, "message": message},
    )


def _has_unresolved_high_findings(db: Session, content: Content) -> bool:
    findings = (
        db.query(Finding)
        .filter(
            Finding.content_id == content.id,
            Finding.content_version == content.version,
            Finding.severity == "high",
        )
        .all()
    )
    for finding in findings:
        if finding.status == "open":
            return True
        if finding.status not in {"accepted", "edited", "dismissed"}:
            return True
        evidence = finding.evidence if isinstance(finding.evidence, dict) else {}
        matched_text = evidence.get("matched_text")
        if not isinstance(matched_text, str) or not matched_text:
            return True
        start = finding.start_offset
        end = finding.end_offset
        if (
            isinstance(start, int)
            and not isinstance(start, bool)
            and isinstance(end, int)
            and not isinstance(end, bool)
            and 0 <= start < end <= len(content.body)
            and content.body[start:end] == matched_text
        ):
            return True
        if matched_text in content.body:
            return True
    return False


def transition_content_status(
    db: Session,
    content_id: int,
    new_status: str,
    actor: str,
    role: str,
    review_comment: Comment | None = None,
) -> Content:
    try:
        actor = actor.strip()
        if not actor.strip():
            raise _workflow_error(
                422,
                "validation_error",
                "The request data is invalid.",
            )

        content = (
            db.query(Content)
            .filter(Content.id == content_id)
            .with_for_update()
            .first()
        )
        if content is None:
            raise _workflow_error(404, "not_found", "Content not found.")

        previous_status = content.status
        allowed_roles = TRANSITION_ROLES.get((previous_status, new_status))
        if allowed_roles is None:
            raise _workflow_error(
                409,
                "invalid_status_transition",
                "Status transition is not allowed.",
            )
        if role not in allowed_roles:
            raise _workflow_error(
                403,
                "forbidden",
                "This role cannot perform this content status transition.",
            )

        if previous_status == "in_review" and new_status == "draft":
            if review_comment is None or not review_comment.body.strip():
                raise _workflow_error(
                    422,
                    "validation_error",
                    "The request data is invalid.",
                )

        if review_comment is not None:
            if (
                previous_status != "in_review"
                or new_status not in {"approved", "draft"}
                or not review_comment.body.strip()
            ):
                raise _workflow_error(
                    422,
                    "validation_error",
                    "The request data is invalid.",
                )
            review_comment.content_id = content.id
            review_comment.author = actor

        if previous_status == "draft" and new_status == "self_checked":
            if content.reviewed_version != content.version:
                raise _workflow_error(
                    409,
                    "review_required",
                    "Run a backend review for the current content version before self-checking.",
                )
            if _has_unresolved_high_findings(db, content):
                raise _workflow_error(
                    409,
                    "open_high_severity_findings",
                    "Content cannot be self-checked while high-severity findings remain unresolved.",
                )

        if previous_status == "self_checked" and new_status == "in_review":
            if _has_unresolved_high_findings(db, content):
                raise _workflow_error(
                    409,
                    "open_high_severity_findings",
                    "Content cannot be submitted while high-severity findings remain unresolved.",
                )

        if previous_status == "in_review" and new_status == "approved":
            if _has_unresolved_high_findings(db, content):
                raise _workflow_error(
                    409,
                    "open_high_severity_findings",
                    "Content cannot be approved while high-severity findings remain unresolved.",
                )

        result = db.execute(
            update(Content)
            .where(
                Content.id == content.id,
                Content.status == previous_status,
            )
            .values(status=new_status),
            execution_options={"synchronize_session": False},
        )
        if result.rowcount != 1:
            raise _workflow_error(
                409,
                "invalid_status_transition",
                "Status transition is not allowed.",
            )

        db.refresh(content)
        if review_comment is not None:
            db.add(review_comment)
        db.add(
            AuditEvent(
                content_id=content.id,
                actor=actor,
                action="content_status_changed",
                details={
                    "actor_role": role,
                    "previous_status": previous_status,
                    "new_status": new_status,
                },
            )
        )
        db.commit()
        return content
    except SQLAlchemyError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
