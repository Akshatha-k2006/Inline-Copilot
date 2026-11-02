import json
import logging

from sqlalchemy.orm import Session

from app.models import AuditEvent, Content
from app.routers.seed import SEED_FILE, load_seed_data, sync_sample_content

logger = logging.getLogger(__name__)
INITIAL_SAMPLE_SETUP_ACTION = "initial_sample_workspace_setup"
INITIAL_SAMPLE_DRAFT_ACTION = "initial_sample_draft_reset"
INITIAL_SAMPLE_SYNC_ACTION = "initial_sample_data_sync_v1"
SAMPLE_DOCUMENT_TITLE = "Spring launch post (sample)"


def initialize_sample_workspace(db: Session) -> bool:
    initialized = (
        db.query(AuditEvent)
        .filter(AuditEvent.action == INITIAL_SAMPLE_SETUP_ACTION)
        .first()
        is not None
    )
    initialized_now = False
    if not initialized:
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
        initialized_now = True
        logger.info(
            "Initialized sample workspace; removed %s other content document(s).",
            seed_result["counts"]["removed_content"],
        )

    draft_reset_done = (
        db.query(AuditEvent)
        .filter(AuditEvent.action == INITIAL_SAMPLE_DRAFT_ACTION)
        .first()
        is not None
    )
    if not draft_reset_done:
        sample = (
            db.query(Content)
            .filter(
                Content.title == SAMPLE_DOCUMENT_TITLE,
                Content.created_by == "Asha",
            )
            .order_by(Content.id)
            .first()
        )
        previous_status = sample.status if sample else None
        if sample and sample.status != "draft":
            sample.status = "draft"
            sample.reviewed_version = None
            sample.reviewed_at = None
            db.add(
                AuditEvent(
                    content_id=sample.id,
                    actor="system",
                    action="content_status_changed",
                    details={
                        "actor_role": "admin",
                        "previous_status": previous_status,
                        "next_status": "draft",
                    },
                )
            )
        db.add(
            AuditEvent(
                actor="system",
                action=INITIAL_SAMPLE_DRAFT_ACTION,
                details={
                    "sample_content_id": sample.id if sample else None,
                    "previous_status": previous_status,
                },
            )
        )
        db.commit()
        if sample and previous_status != "draft":
            logger.info("Reset the demo sample document to draft status.")

    sample_data_synced = (
        db.query(AuditEvent)
        .filter(AuditEvent.action == INITIAL_SAMPLE_SYNC_ACTION)
        .first()
        is not None
    )
    if not sample_data_synced:
        with SEED_FILE.open("r", encoding="utf-8") as file:
            data = json.load(file)
        sample = (
            db.query(Content)
            .filter(
                Content.title == SAMPLE_DOCUMENT_TITLE,
                Content.created_by == "Asha",
            )
            .order_by(Content.id)
            .first()
        )
        reset_content = sample is None or (
            sample.status == "draft"
            and sample.version <= 1
            and sample.reviewed_version is None
        )
        sample, _ = sync_sample_content(
            db,
            data["sample_draft"],
            data["demo_image"],
            reset_content=reset_content,
        )
        db.add(
            AuditEvent(
                actor="system",
                action=INITIAL_SAMPLE_SYNC_ACTION,
                details={
                    "sample_content_id": sample.id,
                    "content_reset": reset_content,
                },
            )
        )
        db.commit()
        logger.info(
            "Synchronized the sample document and bundled image (content reset: %s).",
            reset_content,
        )
    return initialized_now
