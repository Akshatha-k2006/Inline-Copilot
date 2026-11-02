import logging

from sqlalchemy.orm import Session

from app.models import AuditEvent
from app.routers.seed import load_seed_data

logger = logging.getLogger(__name__)
INITIAL_SAMPLE_SETUP_ACTION = "initial_sample_workspace_setup"


def initialize_sample_workspace(db: Session) -> bool:
    if (
        db.query(AuditEvent)
        .filter(AuditEvent.action == INITIAL_SAMPLE_SETUP_ACTION)
        .first()
        is not None
    ):
        return False

    seed_result = load_seed_data("admin", db)
    db.add(
        AuditEvent(
            actor="system",
            action=INITIAL_SAMPLE_SETUP_ACTION,
            details={
                "sample_content_id": seed_result["sample_content_id"],
                "removed_content": seed_result["counts"]["removed_content"],
            },
        )
    )
    db.commit()
    logger.info(
        "Initialized sample workspace; removed %s other content document(s).",
        seed_result["counts"]["removed_content"],
    )
    return True
