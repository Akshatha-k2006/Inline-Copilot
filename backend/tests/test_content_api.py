import asyncio
import json
import unittest
from urllib.parse import urlsplit
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import AuditEvent, Comment, Content, Finding
from app.routers.content import router as content_router
from app.routers.content_workflow import router as workflow_router
from app.routers.health import router as health_router
from app.routers.review import router as review_router


class ContentApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.app = FastAPI()
        register_exception_handlers(self.app)
        self.app.include_router(health_router, prefix="/api")
        self.app.include_router(content_router, prefix="/api")
        self.app.include_router(workflow_router, prefix="/api")
        self.app.include_router(review_router, prefix="/api")

        def override_get_db():
            yield self.db

        self.app.dependency_overrides[get_db] = override_get_db

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def request(
        self,
        path,
        method="GET",
        role="creator",
        user="Asha (Creator)",
        body=None,
    ):
        async def dispatch():
            sent = []
            raw_body = b"" if body is None else json.dumps(body).encode("utf-8")
            parsed_path = urlsplit(path)
            received = False

            async def receive():
                nonlocal received
                if received:
                    return {"type": "http.disconnect"}
                received = True
                return {"type": "http.request", "body": raw_body, "more_body": False}

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
                    "path": parsed_path.path,
                    "raw_path": parsed_path.path.encode("ascii"),
                    "query_string": parsed_path.query.encode("ascii"),
                    "headers": headers,
                    "client": ("testclient", 123),
                    "server": ("testserver", 80),
                },
                receive,
                send,
            )
            status = next(item["status"] for item in sent if item["type"] == "http.response.start")
            response_body = b"".join(
                item.get("body", b"") for item in sent if item["type"] == "http.response.body"
            )
            return status, json.loads(response_body)

        return asyncio.run(dispatch())

    def create(self, title="First item", body="A simple content body."):
        return self.request(
            "/api/content",
            method="POST",
            body={
                "title": title,
                "content_type": "marketing_copy",
                "body": body,
            },
        )

    def test_health_checks_database_and_content_routes_are_registered_once(self):
        status, response = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(response, {"status": "ok"})

        with patch.object(
            self.db,
            "execute",
            side_effect=SQLAlchemyError("database unavailable"),
        ):
            status, response = self.request("/api/health")
        self.assertEqual(status, 503)
        self.assertEqual(response["error"], "database_unavailable")

        for method in ("GET", "PUT"):
            matches = [
                route
                for router in (content_router, workflow_router)
                for route in router.routes
                if getattr(route, "path", None) == "/content/{content_id}"
                and method in getattr(route, "methods", set())
            ]
            self.assertEqual(
                len(matches),
                1,
                f"Expected exactly one {method} handler for a content item.",
            )

        self_check_routes = [
            route
            for route in workflow_router.routes
            if getattr(route, "path", None) == "/content/{content_id}/self-check"
            and "POST" in getattr(route, "methods", set())
        ]
        self.assertEqual(len(self_check_routes), 1)

    def run_review(self, content_id):
        with (
            patch("app.routers.review.check_terminology", return_value=[]),
            patch("app.routers.review.check_claims", return_value=[]),
            patch("app.routers.review.review_with_llm", return_value=[]),
        ):
            return self.request(f"/api/content/{content_id}/review", method="POST")

    def submit(self, content_id):
        review_status, _ = self.run_review(content_id)
        self.assertEqual(review_status, 200)
        check_status, checked = self.request(
            f"/api/content/{content_id}/self-check", method="POST"
        )
        self.assertEqual(check_status, 200)
        self.assertEqual(checked["status"], "self_checked")
        return self.request(f"/api/content/{content_id}/submit", method="POST")

    def test_create_two_items_and_submission_does_not_replace_other_draft(self):
        first_status, first = self.create("First", "First unique text.")
        second_status, second = self.create("Second", "Second unique text.")

        self.assertEqual((first_status, second_status), (201, 201))
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual((first["status"], first["version"]), ("draft", 1))
        self.assertEqual((second["status"], second["version"]), ("draft", 1))
        self.assertEqual(self.db.query(Content).count(), 2)

        submit_status, submitted = self.submit(first["id"])

        self.assertEqual(submit_status, 200)
        self.assertEqual(submitted["status"], "in_review")
        self.assertEqual(self.db.get(Content, first["id"]).status, "in_review")
        self.assertEqual(self.db.get(Content, second["id"]).status, "draft")
        status, drafts = self.request("/api/content?status=draft")
        self.assertEqual(status, 200)
        self.assertEqual([item["id"] for item in drafts], [second["id"]])

    def test_approval_updates_same_persisted_content_and_browser_read_route(self):
        _, created = self.create()
        _, submitted = self.submit(created["id"])
        self.assertEqual(submitted["status"], "in_review")

        status, decision = self.request(
            f"/api/content/{created['id']}/decision",
            method="POST",
            role="reviewer",
            user="Ravi (Reviewer)",
            body={"decision": "approve"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(decision["status"], "approved")
        read_status, persisted = self.request(f"/api/content/{created['id']}")
        self.assertEqual(read_status, 200)
        self.assertEqual(persisted["status"], "approved")
        self.assertEqual(persisted["version"], 1)
        self.assertEqual(self.db.get(Content, created["id"]).status, "approved")
        audit_status, events = self.request(f"/api/content/{created['id']}/audit")
        self.assertEqual(audit_status, 200)
        self.assertTrue(any(event["details"].get("new_status") == "approved" for event in events))

    def test_request_changes_returns_draft_and_persists_comment(self):
        _, created = self.create()
        _, submitted = self.submit(created["id"])
        self.assertEqual(submitted["status"], "in_review")

        status, result = self.request(
            f"/api/content/{created['id']}/decision",
            method="POST",
            role="reviewer",
            user="Ravi (Reviewer)",
            body={
                "decision": "request_changes",
                "comment": "Clarify the supporting evidence.",
            },
        )

        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "draft")
        self.assertEqual(result["comment"]["body"], "Clarify the supporting evidence.")
        self.assertEqual(self.db.get(Content, created["id"]).status, "draft")
        self.assertEqual(self.db.query(Comment).count(), 1)
        comments_status, comments = self.request(f"/api/content/{created['id']}/comments")
        self.assertEqual(comments_status, 200)
        self.assertEqual(comments["comments"][0]["body"], "Clarify the supporting evidence.")

    def test_review_required_current_version_and_optimistic_update(self):
        _, created = self.create()
        status, payload = self.request(
            f"/api/content/{created['id']}/self-check", method="POST"
        )
        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "review_required")

        body = {
            "title": "Updated",
            "content_type": "blog_post",
            "body": "Updated content body.",
            "version": 1,
        }
        update_status, updated = self.request(
            f"/api/content/{created['id']}", method="PUT", body=body
        )
        self.assertEqual(update_status, 200)
        self.assertEqual(updated["version"], 2)
        self.assertEqual(updated["content_type"], "blog_post")
        self.assertIsNone(updated["reviewed_version"])
        stale_status, stale = self.request(
            f"/api/content/{created['id']}", method="PUT", body=body
        )
        self.assertEqual(stale_status, 409)
        self.assertEqual(stale["error"], "stale_content")

    def test_dismissing_high_severity_finding_does_not_bypass_self_check(self):
        _, created = self.create(body="A high risk claim.")
        content = self.db.get(Content, created["id"])
        content.reviewed_version = content.version
        self.db.add(
            Finding(
                content_id=content.id,
                content_version=content.version,
                check_type="unsupported_claim",
                severity="high",
                message="Unsupported claim",
                evidence={"matched_text": "high risk claim"},
                start_offset=2,
                end_offset=17,
                status="dismissed",
            )
        )
        self.db.commit()

        status, response = self.request(
            f"/api/content/{created['id']}/self-check", method="POST"
        )

        self.assertEqual(status, 409)
        self.assertEqual(response["error"], "open_high_severity_findings")
        self.assertEqual(self.db.get(Content, created["id"]).status, "draft")

    def test_role_permissions_and_failure_responses(self):
        denied_status, denied = self.create_with_role("reviewer")
        self.assertEqual(denied_status, 403)
        self.assertEqual(denied["error"], "forbidden")

        _, created = self.create()
        forbidden_status, _ = self.request(
            f"/api/content/{created['id']}",
            role="creator",
            user="Other Creator",
        )
        self.assertEqual(forbidden_status, 403)
        for role, user in (
            ("reviewer", "Ravi (Reviewer)"),
            ("brand_manager", "Bhavana (Brand Manager)"),
            ("admin", "Admin"),
        ):
            status, item = self.request(
                f"/api/content/{created['id']}", role=role, user=user
            )
            self.assertEqual(status, 200)
            self.assertEqual(item["id"], created["id"])

        invalid_status, _ = self.request(
            "/api/content",
            method="POST",
            body={"title": "   ", "content_type": "marketing_copy", "body": "   "},
        )
        self.assertEqual(invalid_status, 422)

    def create_with_role(self, role):
        return self.request(
            "/api/content",
            method="POST",
            role=role,
            user=f"{role}-user",
            body={"title": "Denied", "content_type": "email", "body": "text"},
        )


if __name__ == "__main__":
    unittest.main()
