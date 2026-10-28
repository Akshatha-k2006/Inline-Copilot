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
from app.models import AuditEvent, Comment, Content, Finding
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
            created_by="test-user",
            reviewed_version=2,
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

    def request(
        self,
        path,
        role="creator",
        user="test-user",
        body=None,
        method="POST",
    ):
        async def dispatch():
            sent = []
            received = False
            request_body = (
                b"" if body is None else json.dumps(body).encode("utf-8")
            )

            async def receive():
                nonlocal received
                if received:
                    return {"type": "http.disconnect"}
                received = True
                return {
                    "type": "http.request",
                    "body": request_body,
                    "more_body": False,
                }

            async def send(message):
                sent.append(message)

            headers = []
            if role is not None:
                headers.append((b"x-role", role.encode("ascii")))
            if user is not None:
                headers.append((b"x-user", user.encode("ascii")))
            if body is not None:
                headers.append((b"content-type", b"application/json"))
            await self.app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": method,
                    "scheme": "http",
                    "path": path,
                    "raw_path": path.encode("ascii"),
                    "query_string": b"",
                    "headers": headers,
                    "client": ("127.0.0.1", 123),
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
        original_body = self.content.body
        original_version = self.content.version
        for target, role in (
            ("self_checked", "creator"),
            ("in_review", "creator"),
            ("approved", "reviewer"),
            ("ready_to_publish", "brand_manager"),
        ):
            result = transition_content_status(
                self.db, self.content.id, target, "workflow-user", role
            )

            self.assertEqual(result.status, target)
            self.assertEqual(result.body, original_body)
            self.assertEqual(result.version, original_version)

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
                    event.id,
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
                    1,
                ),
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "self_checked",
                    "in_review",
                    "creator",
                    True,
                    2,
                ),
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "in_review",
                    "approved",
                    "reviewer",
                    True,
                    3,
                ),
                (
                    "content_status_changed",
                    "workflow-user",
                    1,
                    "approved",
                    "ready_to_publish",
                    "brand_manager",
                    True,
                    4,
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
                    "remain unresolved."
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
            user="test-user",
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
        self.assertEqual(event.actor, "test-user")
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
                    "remain unresolved."
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

    def test_reviewer_approval_returns_exact_response_and_records_audit(self):
        self.content.status = "in_review"
        original_body = self.content.body
        original_version = self.content.version
        self.db.commit()

        status, payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            user="reviewer-user",
            body={"decision": "approve"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            payload,
            {
                "content_id": 1,
                "status": "approved",
                "content_version": original_version,
                "comment": None,
            },
        )
        self.assertEqual(self.content.body, original_body)
        self.assertEqual(self.content.version, original_version)
        self.assertEqual(self.db.query(Comment).count(), 0)
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.action, "content_status_changed")
        self.assertEqual(event.actor, "reviewer-user")
        self.assertEqual(event.content_id, self.content.id)
        self.assertEqual(
            event.details,
            {
                "actor_role": "reviewer",
                "previous_status": "in_review",
                "new_status": "approved",
            },
        )
        self.assertIsNotNone(event.created_at)

    def test_request_changes_persists_and_returns_review_comment(self):
        self.content.status = "in_review"
        original_body = self.content.body
        original_version = self.content.version
        self.db.commit()

        status, payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            user="reviewer-user",
            body={
                "decision": "request_changes",
                "comment": "  Please clarify the supporting claim.  ",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            set(payload),
            {"content_id", "status", "content_version", "comment"},
        )
        self.assertEqual(payload["content_id"], self.content.id)
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(payload["content_version"], original_version)
        self.assertEqual(
            set(payload["comment"]),
            {"id", "author", "body", "created_at"},
        )
        self.assertEqual(payload["comment"]["author"], "reviewer-user")
        self.assertEqual(
            payload["comment"]["body"],
            "Please clarify the supporting claim.",
        )
        self.assertIsInstance(payload["comment"]["id"], int)
        self.assertIsInstance(payload["comment"]["created_at"], str)

        saved_comment = self.db.get(Comment, payload["comment"]["id"])
        self.assertEqual(saved_comment.content_id, self.content.id)
        self.assertEqual(saved_comment.author, "reviewer-user")
        self.assertEqual(
            saved_comment.body,
            "Please clarify the supporting claim.",
        )
        self.assertEqual(self.content.body, original_body)
        self.assertEqual(self.content.version, original_version)
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.content_id, self.content.id)
        self.assertEqual(event.actor, "reviewer-user")
        self.assertEqual(event.details["previous_status"], "in_review")
        self.assertEqual(event.details["new_status"], "draft")
        self.assertIsNotNone(event.created_at)

        read_status, read_payload = self.request(
            "/api/content/1/comments",
            role="creator",
            user="test-user",
            method="GET",
        )
        self.assertEqual(read_status, 200)
        self.assertEqual(read_payload["content_id"], self.content.id)
        self.assertEqual(read_payload["comments"], [payload["comment"]])

    def test_review_decision_rejects_unauthorized_roles(self):
        self.content.status = "in_review"
        self.db.commit()

        status, payload = self.request(
            "/api/content/1/decision",
            role="creator",
            body={"decision": "approve"},
        )

        self.assertEqual(status, 403)
        self.assertEqual(
            payload,
            {
                "error": "forbidden",
                "message": (
                    "This role cannot perform this content status transition."
                ),
            },
        )
        self.assertEqual(self.content.status, "in_review")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

        missing_role_status, missing_role_payload = self.request(
            "/api/content/1/decision",
            role=None,
            body={"decision": "approve"},
        )
        missing_actor_status, missing_actor_payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            user=None,
            body={"decision": "approve"},
        )
        self.assertEqual(missing_role_status, 403)
        self.assertEqual(
            missing_role_payload,
            {
                "error": "forbidden",
                "message": "A valid role is required.",
            },
        )
        self.assertEqual(missing_actor_status, 422)
        self.assertEqual(
            missing_actor_payload,
            {
                "error": "validation_error",
                "message": "The request data is invalid.",
            },
        )
        self.assertEqual(self.content.status, "in_review")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_review_decision_rejects_invalid_decisions_and_missing_comments(self):
        invalid_decision_status, invalid_decision_payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            body={"decision": "reject"},
        )
        missing_comment_status, missing_comment_payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            body={"decision": "request_changes"},
        )
        blank_comment_status, blank_comment_payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            body={"decision": "request_changes", "comment": "   "},
        )

        for status, payload in (
            (invalid_decision_status, invalid_decision_payload),
            (missing_comment_status, missing_comment_payload),
            (blank_comment_status, blank_comment_payload),
        ):
            self.assertEqual(status, 422)
            self.assertEqual(
                payload,
                {
                    "error": "validation_error",
                    "message": "The request data is invalid.",
                },
            )
        self.assertEqual(self.content.status, "draft")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_review_decision_rejects_invalid_status_with_exact_409(self):
        status, payload = self.request(
            "/api/content/1/decision",
            role="reviewer",
            body={"decision": "approve"},
        )

        self.assertEqual(status, 409)
        self.assertEqual(
            payload,
            {
                "error": "invalid_status_transition",
                "message": "Status transition is not allowed.",
            },
        )
        self.assertEqual(self.content.status, "draft")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_review_decision_rolls_back_when_comment_persistence_fails(self):
        self.content.status = "in_review"
        self.db.commit()
        add = self.db.add

        def fail_on_comment(instance):
            if isinstance(instance, Comment):
                raise SQLAlchemyError("comment write failed")
            add(instance)

        with patch.object(self.db, "add", side_effect=fail_on_comment):
            status, payload = self.request(
                "/api/content/1/decision",
                role="reviewer",
                body={
                    "decision": "request_changes",
                    "comment": "Please revise.",
                },
            )

        self.db.expire_all()
        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "workflow_failed",
                "message": "Unable to save review decision.",
            },
        )
        self.assertEqual(self.db.get(Content, 1).status, "in_review")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_review_decision_rolls_back_when_audit_persistence_fails(self):
        self.content.status = "in_review"
        self.db.commit()
        add = self.db.add

        def fail_on_audit(instance):
            if isinstance(instance, AuditEvent):
                raise SQLAlchemyError("audit write failed")
            add(instance)

        with patch.object(self.db, "add", side_effect=fail_on_audit):
            status, payload = self.request(
                "/api/content/1/decision",
                role="reviewer",
                body={
                    "decision": "request_changes",
                    "comment": "Please revise.",
                },
            )

        self.db.expire_all()
        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "workflow_failed",
                "message": "Unable to save review decision.",
            },
        )
        self.assertEqual(self.db.get(Content, 1).status, "in_review")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_ready_to_publish_by_brand_manager_and_admin_records_one_audit(self):
        original_body = self.content.body
        original_version = self.content.version

        for role in ("brand_manager", "admin"):
            self.content.status = "approved"
            self.db.commit()

            status, payload = self.request(
                "/api/content/1/ready-to-publish",
                role=role,
                user=f"{role}-user",
            )

            self.assertEqual(status, 200)
            self.assertEqual(
                payload,
                {
                    "content_id": 1,
                    "status": "ready_to_publish",
                    "content_version": original_version,
                },
            )
            self.assertEqual(self.content.body, original_body)
            self.assertEqual(self.content.version, original_version)
            event = self.db.query(AuditEvent).one()
            self.assertEqual(event.action, "content_status_changed")
            self.assertEqual(event.actor, f"{role}-user")
            self.assertEqual(event.content_id, self.content.id)
            self.assertEqual(
                event.details,
                {
                    "actor_role": role,
                    "previous_status": "approved",
                    "new_status": "ready_to_publish",
                },
            )
            self.assertIsNotNone(event.created_at)

            repeated_status, repeated_payload = self.request(
                "/api/content/1/ready-to-publish",
                role=role,
                user=f"{role}-user",
            )
            self.assertEqual(repeated_status, 409)
            self.assertEqual(
                repeated_payload,
                {
                    "error": "invalid_status_transition",
                    "message": "Status transition is not allowed.",
                },
            )
            self.assertEqual(self.db.query(AuditEvent).count(), 1)
            self.db.query(AuditEvent).delete()
            self.db.commit()

    def test_ready_to_publish_rejects_unauthorized_roles(self):
        self.content.status = "approved"
        self.db.commit()

        for role in ("creator", "reviewer"):
            status, payload = self.request(
                "/api/content/1/ready-to-publish",
                role=role,
            )
            self.assertEqual(status, 403)
            self.assertEqual(payload["error"], "forbidden")
            self.assertEqual(self.content.status, "approved")
            self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_ready_to_publish_invalid_status_returns_exact_409(self):
        status, payload = self.request(
            "/api/content/1/ready-to-publish",
            role="brand_manager",
        )

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

    def test_ready_to_publish_rolls_back_when_audit_persistence_fails(self):
        self.content.status = "approved"
        self.db.commit()
        add = self.db.add

        def fail_on_audit(instance):
            if isinstance(instance, AuditEvent):
                raise SQLAlchemyError("audit write failed")
            add(instance)

        with patch.object(self.db, "add", side_effect=fail_on_audit):
            status, payload = self.request(
                "/api/content/1/ready-to-publish",
                role="admin",
            )

        self.db.expire_all()
        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "workflow_failed",
                "message": "Unable to update content status.",
            },
        )
        self.assertEqual(self.db.get(Content, 1).status, "approved")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_standalone_comment_creation_and_retrieval(self):
        self.content.status = "in_review"
        self.db.commit()

        status, payload = self.request(
            "/api/content/1/comments",
            role="reviewer",
            user="reviewer-user",
            body={"body": "  Please add evidence.  "},
        )

        self.assertEqual(status, 201)
        self.assertEqual(
            set(payload),
            {"id", "author", "body", "created_at"},
        )
        self.assertEqual(payload["author"], "reviewer-user")
        self.assertEqual(payload["body"], "Please add evidence.")
        self.assertIsInstance(payload["id"], int)
        self.assertIsInstance(payload["created_at"], str)
        comment = self.db.get(Comment, payload["id"])
        self.assertEqual(comment.content_id, self.content.id)
        self.assertEqual(comment.author, "reviewer-user")
        self.assertEqual(comment.body, "Please add evidence.")
        comment_event = self.db.query(AuditEvent).one()
        self.assertEqual(comment_event.action, "comment_added")
        self.assertEqual(comment_event.actor, "reviewer-user")
        self.assertEqual(comment_event.content_id, self.content.id)
        self.assertEqual(
            comment_event.details,
            {"comment_id": comment.id, "actor_role": "reviewer"},
        )
        self.assertIsNotNone(comment_event.created_at)

        read_status, read_payload = self.request(
            "/api/content/1/comments",
            role="creator",
            user="test-user",
            method="GET",
        )
        self.assertEqual(read_status, 200)
        self.assertEqual(
            read_payload,
            {"content_id": 1, "comments": [payload]},
        )
        for role in ("reviewer", "brand_manager", "admin"):
            role_status, role_payload = self.request(
                "/api/content/1/comments",
                role=role,
                user=f"{role}-user",
                method="GET",
            )
            self.assertEqual(role_status, 200)
            self.assertEqual(role_payload, read_payload)

    def test_standalone_comment_validation_and_role_authorization(self):
        self.content.status = "in_review"
        self.db.commit()

        for body in ({}, {"body": "  "}, {"body": "Valid", "extra": True}):
            status, payload = self.request(
                "/api/content/1/comments",
                role="reviewer",
                body=body,
            )
            self.assertEqual(status, 422)
            self.assertEqual(
                payload,
                {
                    "error": "validation_error",
                    "message": "The request data is invalid.",
                },
            )

        unauthorized_status, unauthorized_payload = self.request(
            "/api/content/1/comments",
            role="creator",
            body={"body": "Please revise."},
        )
        self.assertEqual(unauthorized_status, 403)
        self.assertEqual(unauthorized_payload["error"], "forbidden")

        missing_role_status, missing_role_payload = self.request(
            "/api/content/1/comments",
            role=None,
            body={"body": "Please revise."},
        )
        missing_actor_status, missing_actor_payload = self.request(
            "/api/content/1/comments",
            role="reviewer",
            user=None,
            body={"body": "Please revise."},
        )
        self.assertEqual(missing_role_status, 403)
        self.assertEqual(missing_role_payload["error"], "forbidden")
        self.assertEqual(missing_actor_status, 422)
        self.assertEqual(missing_actor_payload["error"], "validation_error")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_comment_creation_rejects_content_outside_in_review(self):
        status, payload = self.request(
            "/api/content/1/comments",
            role="reviewer",
            body={"body": "Please revise."},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "forbidden")
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_comment_retrieval_checks_content_ownership_and_not_found(self):
        unauthorized_status, unauthorized_payload = self.request(
            "/api/content/1/comments",
            role="creator",
            user="another-creator",
            method="GET",
        )
        missing_status, missing_payload = self.request(
            "/api/content/999/comments",
            role="reviewer",
            method="GET",
        )

        self.assertEqual(unauthorized_status, 403)
        self.assertEqual(unauthorized_payload["error"], "forbidden")
        self.assertEqual(missing_status, 404)
        self.assertEqual(
            missing_payload,
            {"error": "not_found", "message": "Content not found."},
        )

    def test_standalone_comment_rolls_back_when_audit_persistence_fails(self):
        self.content.status = "in_review"
        self.db.commit()
        add = self.db.add

        def fail_on_audit(instance):
            if isinstance(instance, AuditEvent):
                raise SQLAlchemyError("audit write failed")
            add(instance)

        with patch.object(self.db, "add", side_effect=fail_on_audit):
            status, payload = self.request(
                "/api/content/1/comments",
                role="reviewer",
                body={"body": "Please revise."},
            )

        self.db.expire_all()
        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "workflow_failed",
                "message": "Unable to save review comment.",
            },
        )
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_standalone_comment_rolls_back_when_comment_persistence_fails(self):
        self.content.status = "in_review"
        self.db.commit()
        add = self.db.add

        def fail_on_comment(instance):
            if isinstance(instance, Comment):
                raise SQLAlchemyError("comment write failed")
            add(instance)

        with patch.object(self.db, "add", side_effect=fail_on_comment):
            status, payload = self.request(
                "/api/content/1/comments",
                role="reviewer",
                body={"body": "Please revise."},
            )

        self.db.expire_all()
        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "workflow_failed",
                "message": "Unable to save review comment.",
            },
        )
        self.assertEqual(self.db.query(Comment).count(), 0)
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
