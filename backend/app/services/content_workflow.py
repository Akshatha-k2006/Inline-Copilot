from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.models import AuditEvent, Content, Finding

TRANSITION_ROLES = {
    ("draft", "self_checked"): {"creator"},
    ("self_checked", "in_review"): {"creator"},
    ("in_review", "approved"): {"reviewer"},
    ("approved", "ready_to_publish"): {"brand_manager", "admin"},
}


def _workflow_error(status_code: int, error: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={"error": error, "message": message},
    )


def transition_content_status(
    db: Session,
    content_id: int,
    new_status: str,
    actor: str,
    role: str,
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

        if previous_status == "self_checked" and new_status == "in_review":
            blocking_finding = (
                db.query(Finding.id)
                .filter(
                    Finding.content_id == content.id,
                    Finding.content_version == content.version,
                    Finding.status == "open",
                    Finding.severity == "high",
                )
                .first()
            )
            if blocking_finding is not None:
                raise _workflow_error(
                    409,
                    "open_high_severity_findings",
                    "Content cannot be submitted while high-severity findings remain open.",
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
