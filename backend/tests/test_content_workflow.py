import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi import Depends, FastAPI, Header
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.dependencies import get_role
from app.exception_handlers import register_exception_handlers
from app.models import AuditEvent, Content, Finding
from app.routers.content_workflow import router as content_workflow_router
from app.services.content_workflow import transition_content_status


class ContentWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.content = Content(
            id=1,
            title="Workflow test",
            body="Draft text",
            status="draft",
            version=2,
            created_by="creator-user",
        )
        self.db.add(self.content)
        self.db.commit()

        self.app = FastAPI()
        register_exception_handlers(self.app)
        self.app.include_router(content_workflow_router, prefix="/api")

        def override_get_db():
            yield self.db

        self.app.dependency_overrides[get_db] = override_get_db

        @self.app.post("/content/{content_id}/status/{new_status}")
        def transition(
            content_id: int,
            new_status: str,
            x_user: str = Header(),
            role: str = Depends(get_role),
            db: Session = Depends(get_db),
        ):
            content = transition_content_status(
                db, content_id, new_status, x_user, role
            )
            return {"id": content.id, "status": content.status}

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def request(self, path, role="creator", user="test-user"):
        async def dispatch():
            sent = []
            received = False

            async def receive():
                nonlocal received
                if received:
                    return {"type": "http.disconnect"}
                received = True
                return {
                    "type": "http.request",
                    "body": b"",
                    "more_body": False,
                }

            async def send(message):
                sent.append(message)

            headers = []
            if role is not None:
                headers.append((b"x-role", role.encode("ascii")))
            if user is not None:
                headers.append((b"x-user", user.encode("ascii")))
            await self.app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "http",
                    "path": path,
                    "raw_path": path.encode("ascii"),
                    "query_string": b"",
                    "headers": headers,
                    "client": ("testclient", 123),
                    "server": ("testserver", 80),
                },
                receive,
                send,
            )
            status = next(
                item["status"]
                for item in sent
                if item["type"] == "http.response.start"
            )
            response_body = b"".join(
                item.get("body", b"")
                for item in sent
                if item["type"] == "http.response.body"
            )
            return status, json.loads(response_body)

        return asyncio.run(dispatch())

    def test_allowed_transitions_record_statuses_and_audit_events(self):
        for target, role in (
            ("self_checked", "creator"),
            ("in_review", "creator"),
            ("approved", "reviewer"),
            ("ready_to_publish", "brand_manager"),
        ):
            self.content.status = {
                "self_checked": "draft",
                "in_review": "self_checked",
                "approved": "in_review",
                "ready_to_publish": "approved",
            }[target]
            self.db.commit()

            result = transition_content_status(
                self.db, self.content.id, target, "workflow-user", role
            )

            self.assertEqual(result.status, target)

        events = self.db.query(AuditEvent).order_by(AuditEvent.id).all()
        self.assertEqual(len(events), 4)
        self.assertEqual(
            [
                (
                    event.action,
                    event.actor,
                    event.content_id,
                    event.details["previous_status"],
                    event.details["new_status"],
                    event.details["actor_role"],
                    event.created_at is not None,
                )
                for event in events
            ],
            [
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "draft",
                    "self_checked",
                    "creator",
                    True,
                ),
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "self_checked",
                    "in_review",
                    "creator",
                    True,
                ),
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "in_review",
                    "approved",
                    "reviewer",
                    True,
                ),
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "approved",
                    "ready_to_publish",
                    "brand_manager",
                    True,
                ),
            ],
        )

    def test_invalid_transition_returns_contract_409(self):
        status, payload = self.request("/content/1/status/approved")

        self.assertEqual(status, 409)
        self.assertEqual(
            payload,
            {
                "error": "invalid_status_transition",
                "message": "Status transition is not allowed.",
            },
        )
        self.assertEqual(self.content.status, "draft")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_role_must_be_allowed_for_transition(self):
        status, payload = self.request(
            "/content/1/status/self_checked",
            role="reviewer",
        )

        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "forbidden")
        self.assertEqual(self.content.status, "draft")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_submission_is_blocked_by_open_high_finding_on_current_version(self):
        self.content.status = "self_checked"
        self.db.add(
            Finding(
                content_id=self.content.id,
                content_version=self.content.version,
                check_type="unsupported_claim",
                severity="high",
                message="Unsupported claim",
                evidence={"matched_text": "claim"},
                status="open",
            )
        )
        self.db.commit()

        status, payload = self.request(
            "/content/1/status/in_review",
            role="creator",
        )

        self.assertEqual(status, 409)
        self.assertEqual(
            payload,
            {
                "error": "open_high_severity_findings",
                "message": (
                    "Content cannot be submitted while high-severity findings "
                    "remain open."
                ),
            },
        )
        self.assertEqual(self.content.status, "self_checked")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_submit_endpoint_succeeds_with_exact_response_and_audit(self):
        self.content.status = "self_checked"
        original_body = self.content.body
        original_version = self.content.version
        self.db.commit()

        status, payload = self.request(
            "/api/content/1/submit",
            role="creator",
            user="submitter",
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            payload,
            {
                "content_id": 1,
                "status": "in_review",
                "content_version": original_version,
            },
        )
        self.assertEqual(self.content.body, original_body)
        self.assertEqual(self.content.version, original_version)
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.content_id, self.content.id)
        self.assertEqual(event.actor, "submitter")
        self.assertEqual(event.action, "content_status_changed")
        self.assertEqual(
            event.details,
            {
                "actor_role": "creator",
                "previous_status": "self_checked",
                "new_status": "in_review",
            },
        )
        self.assertIsNotNone(event.created_at)

    def test_submit_endpoint_rejects_non_creator(self):
        self.content.status = "self_checked"
        self.db.commit()

        status, payload = self.request(
            "/api/content/1/submit",
            role="reviewer",
        )

        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "forbidden")
        self.assertEqual(self.content.status, "self_checked")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_submit_endpoint_invalid_status_uses_exact_409_response(self):
        status, payload = self.request("/api/content/1/submit")

        self.assertEqual(status, 409)
        self.assertEqual(
            payload,
            {
                "error": "invalid_status_transition",
                "message": "Status transition is not allowed.",
            },
        )
        self.assertEqual(self.content.status, "draft")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_submit_endpoint_blocker_error_has_documented_response(self):
        self.content.status = "self_checked"
        self.db.add(
            Finding(
                content_id=self.content.id,
                content_version=self.content.version,
                check_type="unsupported_claim",
                severity="high",
                message="Unsupported claim",
                evidence={"matched_text": "claim"},
                status="open",
            )
        )
        self.db.commit()

        status, payload = self.request("/api/content/1/submit")

        self.assertEqual(status, 409)
        self.assertEqual(
            payload,
            {
                "error": "open_high_severity_findings",
                "message": (
                    "Content cannot be submitted while high-severity findings "
                    "remain open."
                ),
            },
        )
        self.assertEqual(self.content.status, "self_checked")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_submit_endpoint_requires_role_and_actor_headers(self):
        self.content.status = "self_checked"
        self.db.commit()

        missing_role_status, missing_role_payload = self.request(
            "/api/content/1/submit",
            role=None,
        )
        missing_user_status, missing_user_payload = self.request(
            "/api/content/1/submit",
            user=None,
        )

        self.assertEqual(missing_role_status, 403)
        self.assertEqual(missing_role_payload["error"], "forbidden")
        self.assertEqual(missing_user_status, 422)
        self.assertEqual(missing_user_payload["error"], "validation_error")
        self.assertEqual(self.content.status, "self_checked")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_submit_endpoint_rolls_back_when_audit_commit_fails(self):
        self.content.status = "self_checked"
        self.db.commit()

        with patch.object(
            self.db, "commit", side_effect=SQLAlchemyError("audit write failed")
        ):
            status, payload = self.request("/api/content/1/submit")

        self.db.expire_all()
        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "workflow_failed",
                "message": "Unable to submit content for review.",
            },
        )
        self.assertEqual(self.db.get(Content, 1).status, "self_checked")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_non_open_or_old_version_high_finding_does_not_block_submission(self):
        self.content.status = "self_checked"
        self.db.add_all(
            [
                Finding(
                    content_id=self.content.id,
                    content_version=self.content.version,
                    check_type="tone",
                    severity="high",
                    message="Resolved finding",
                    evidence={"matched_text": "claim"},
                    status="dismissed",
                ),
                Finding(
                    content_id=self.content.id,
                    content_version=self.content.version - 1,
                    check_type="tone",
                    severity="high",
                    message="Stale finding",
                    evidence={"matched_text": "claim"},
                    status="open",
                ),
            ]
        )
        self.db.commit()

        result = transition_content_status(
            self.db, self.content.id, "in_review", "creator-user", "creator"
        )

        self.assertEqual(result.status, "in_review")
        self.assertEqual(self.db.query(AuditEvent).count(), 1)

    def test_failed_commit_rolls_back_status_and_audit_event(self):
        with patch.object(
            self.db, "commit", side_effect=SQLAlchemyError("database failure")
        ):
            with self.assertRaises(SQLAlchemyError):
                transition_content_status(
                    self.db,
                    self.content.id,
                    "self_checked",
                    "creator-user",
                    "creator",
                )

        self.db.expire_all()
        self.assertEqual(self.db.get(Content, self.content.id).status, "draft")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)


if __name__ == "__main__":
    unittest.main()
