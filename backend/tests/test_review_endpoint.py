import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import create_engine, inspect, text, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db, migrate_review_schema
from app.exception_handlers import register_exception_handlers
from app.models import AuditEvent, Content, Finding, Term
from app.routers.review import review_content


class ReviewEndpointTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all(
            [
                Content(
                    id=1,
                    title="Review test",
                    body="best badword",
                    version=3,
                    created_by="test-user",
                ),
                Term(
                    id=1,
                    term="badword",
                    replacement="good word",
                    status="prohibited",
                ),
            ]
        )
        self.db.commit()

        app = FastAPI()
        register_exception_handlers(app)
        from app.routers.review import router

        app.include_router(router, prefix="/api")

        def override_get_db():
            yield self.db

        app.dependency_overrides[get_db] = override_get_db
        self.app = app

    def request(self, path, method="POST", body=None, user="test-user"):
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

            raw_path = path.encode("ascii")
            headers = []
            headers.append((b"x-role", b"creator"))
            if user is not None:
                headers.append((b"x-user", user.encode("ascii")))
            request_payload = b""
            if body is not None:
                request_payload = json.dumps(body).encode("utf-8")
                headers.append((b"content-type", b"application/json"))
            await self.app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": method,
                    "scheme": "http",
                    "path": path,
                    "raw_path": raw_path,
                    "query_string": b"",
                    "headers": headers,
                    "client": ("testclient", 123),
                    "server": ("testserver", 80),
                },
                receive
                if not request_payload
                else self._body_receiver(request_payload),
                send,
            )
            status = next(
                message["status"]
                for message in sent
                if message["type"] == "http.response.start"
            )
            response_body = b"".join(
                message.get("body", b"")
                for message in sent
                if message["type"] == "http.response.body"
            )
            return status, json.loads(response_body)

        return asyncio.run(dispatch())

    @staticmethod
    def _body_receiver(body):
        received = False

        async def receive():
            nonlocal received
            if received:
                return {"type": "http.disconnect"}
            received = True
            return {
                "type": "http.request",
                "body": body,
                "more_body": False,
            }

        return receive

    def add_finding(
        self,
        *,
        content_version=3,
        check_type="tone",
        status="open",
        message="Existing finding",
        start_offset=0,
        end_offset=4,
        matched_text="best",
        suggested_fix=None,
    ):
        finding = Finding(
            content_id=1,
            content_version=content_version,
            check_type=check_type,
            severity="warning",
            message=message,
            evidence={"matched_text": matched_text},
            suggested_fix=suggested_fix,
            start_offset=start_offset,
            end_offset=end_offset,
            status=status,
        )
        self.db.add(finding)
        self.db.commit()
        return finding

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_review_persists_versioned_findings_and_exact_response_shape(self):
        with patch("app.services.llm_reviewer.settings.llm_api_key", None):
            status, payload = self.request("/api/content/1/review")

        self.assertEqual(status, 200)
        self.assertEqual(
            set(payload),
            {"content_id", "content_version", "findings", "engine"},
        )
        self.assertEqual(payload["content_id"], 1)
        self.assertEqual(payload["content_version"], 3)
        self.assertIsInstance(payload["content_id"], int)
        self.assertIsInstance(payload["content_version"], int)
        self.assertIsInstance(payload["findings"], list)
        self.assertIsInstance(payload["engine"], dict)
        self.assertEqual(payload["engine"], {"rules": "ok", "llm": "disabled"})
        self.assertEqual(
            [item["start_offset"] for item in payload["findings"]],
            sorted(item["start_offset"] for item in payload["findings"]),
        )
        for finding in payload["findings"]:
            self.assertEqual(
                set(finding),
                {
                    "id",
                    "check",
                    "severity",
                    "message",
                    "evidence",
                    "suggested_fix",
                    "start_offset",
                    "end_offset",
                    "status",
                },
            )
            self.assertIsInstance(finding["id"], int)
            self.assertIsInstance(finding["check"], str)
            self.assertIsInstance(finding["severity"], str)
            self.assertIsInstance(finding["message"], str)
            self.assertIsInstance(finding["evidence"], dict)
            self.assertIsInstance(finding["status"], str)
            self.assertTrue(
                {"matched_text", "source", "requires_manual_review"}
                <= set(finding["evidence"])
            )
            self.assertIsInstance(finding["evidence"]["matched_text"], str)
            self.assertIsInstance(finding["evidence"]["source"], dict)
            self.assertIsInstance(
                finding["evidence"]["requires_manual_review"],
                bool,
            )
            self.assertTrue(
                finding["suggested_fix"] is None
                or isinstance(finding["suggested_fix"], str)
            )
            self.assertTrue(
                finding["start_offset"] is None
                or isinstance(finding["start_offset"], int)
            )
            self.assertTrue(
                finding["end_offset"] is None
                or isinstance(finding["end_offset"], int)
            )

        persisted = self.db.query(Finding).order_by(Finding.start_offset).all()
        self.assertEqual(len(persisted), len(payload["findings"]))
        self.assertTrue(
            all(
                finding.content_id == 1 and finding.content_version == 3
                for finding in persisted
            )
        )
        self.assertEqual(
            [finding.id for finding in persisted],
            [finding["id"] for finding in payload["findings"]],
        )

    def test_missing_content_uses_contract_error(self):
        status, payload = self.request("/api/content/999/review")

        self.assertEqual(status, 404)
        self.assertEqual(payload, {"error": "not_found", "message": "Content not found."})

    def test_repeated_review_replaces_open_findings_without_duplicates(self):
        with patch("app.services.llm_reviewer.settings.llm_api_key", None):
            first_status, first = self.request("/api/content/1/review")
            second_status, second = self.request("/api/content/1/review")

        self.assertEqual((first_status, second_status), (200, 200))
        self.assertEqual(len(first["findings"]), len(second["findings"]))
        findings = (
            self.db.query(Finding)
            .filter(
                Finding.content_id == 1,
                Finding.content_version == 3,
                Finding.status == "open",
            )
            .all()
        )
        self.assertEqual(len(findings), len(second["findings"]))
        self.assertEqual(
            {finding.id for finding in findings},
            {item["id"] for item in second["findings"]},
        )

    def test_review_action_rerun_lifecycle_keeps_resolved_findings(self):
        content = self.db.get(Content, 1)
        content.body = "badword then badword"
        self.db.commit()

        with patch("app.services.llm_reviewer.settings.llm_api_key", None):
            review_status, review = self.request("/api/content/1/review")

        self.assertEqual(review_status, 200)
        term_findings = [
            item for item in review["findings"] if item["check"] == "terminology"
        ]
        self.assertEqual(len(term_findings), 2)
        first, second = term_findings
        first_status, first_result = self.request(
            f"/api/findings/{first['id']}",
            method="PATCH",
            body={"action": "accept"},
        )
        self.assertEqual(first_status, 200)
        self.assertEqual(first_result["content_version"], 4)
        self.assertEqual(content.body, "good word then badword")

        shifted_second = self.db.get(Finding, second["id"])
        self.assertEqual(shifted_second.start_offset, 15)
        self.assertEqual(shifted_second.content_version, 4)
        second_status, second_result = self.request(
            f"/api/findings/{second['id']}",
            method="PATCH",
            body={"action": "accept"},
        )
        self.assertEqual(second_status, 200)
        self.assertEqual(second_result["content_version"], 5)
        self.assertEqual(content.body, "good word then good word")

        rerun_status, rerun = self.request("/api/content/1/review")

        self.assertEqual(rerun_status, 200)
        self.assertEqual(rerun["content_version"], 5)
        accepted = (
            self.db.query(Finding)
            .filter(Finding.status == "accepted")
            .order_by(Finding.id)
            .all()
        )
        self.assertEqual([item.id for item in accepted], [first["id"], second["id"]])
        self.assertTrue(all(item.content_version == 5 for item in accepted))
        self.assertEqual(self.db.query(AuditEvent).count(), 4)
        self.assertEqual(
            [
                (
                    event.action,
                    event.details.get("previous_version"),
                    event.details.get("new_version"),
                )
                for event in self.db.query(AuditEvent).order_by(AuditEvent.id)
            ],
            [
                ("content_reviewed", None, None),
                ("finding_accepted", 3, 4),
                ("finding_accepted", 4, 5),
                ("content_reviewed", None, None),
            ],
        )

    def test_rerun_replaces_outdated_open_findings_for_current_version(self):
        old = self.add_finding(
            check_type="tone",
            message="Obsolete review result",
        )

        with patch("app.services.llm_reviewer.settings.llm_api_key", None):
            status, payload = self.request("/api/content/1/review")

        self.assertEqual(status, 200)
        self.assertEqual(
            self.db.query(Finding)
            .filter(Finding.message == "Obsolete review result")
            .count(),
            0,
        )
        self.assertNotIn(
            "Obsolete review result",
            {item["message"] for item in payload["findings"]},
        )
        self.assertTrue(payload["findings"])
        self.assertTrue(
            all(item["status"] == "open" for item in payload["findings"])
        )

    def test_rerun_preserves_accepted_and_dismissed_findings(self):
        accepted = self.add_finding(status="accepted", message="Accepted result")
        dismissed = self.add_finding(
            status="dismissed",
            message="Dismissed result",
            start_offset=1,
            end_offset=3,
        )

        with patch("app.services.llm_reviewer.settings.llm_api_key", None):
            status, payload = self.request("/api/content/1/review")

        self.assertEqual(status, 200)
        self.assertEqual(self.db.get(Finding, accepted.id).status, "accepted")
        self.assertEqual(self.db.get(Finding, dismissed.id).status, "dismissed")
        self.assertNotIn(
            accepted.id,
            {item["id"] for item in payload["findings"]},
        )
        self.assertNotIn(
            dismissed.id,
            {item["id"] for item in payload["findings"]},
        )

    def test_rerun_leaves_findings_from_other_content_versions_untouched(self):
        previous_version = self.add_finding(
            content_version=2,
            message="Previous version finding",
        )

        with patch("app.services.llm_reviewer.settings.llm_api_key", None):
            status, payload = self.request("/api/content/1/review")

        self.assertEqual(status, 200)
        preserved = self.db.get(Finding, previous_version.id)
        self.assertIsNotNone(preserved)
        self.assertEqual(preserved.content_version, 2)
        self.assertEqual(preserved.message, "Previous version finding")
        self.assertTrue(
            all(item["id"] != previous_version.id for item in payload["findings"])
        )

    def test_invalid_content_id_uses_validation_error_contract(self):
        status, payload = self.request("/api/content/not-an-id/review")

        self.assertEqual(status, 422)
        self.assertEqual(
            payload,
            {
                "error": "validation_error",
                "message": "The request data is invalid.",
            },
        )

    def test_findings_have_deterministic_position_and_tie_order(self):
        self.db.get(Content, 1).body = "abcdefghij"
        self.db.commit()

        def finding(check, start, end):
            return {
                "check": check,
                "severity": "warning",
                "message": check,
                "matched_text": "abcdefghij"[start:end],
                "start_offset": start,
                "end_offset": end,
                "suggested_fix": None,
                "source": {"type": "guideline", "id": 1},
                "evidence": {},
            }

        with (
            patch(
                "app.routers.review.check_terminology",
                return_value=[finding("terminology", 4, 5)],
            ),
            patch(
                "app.routers.review.check_claims",
                return_value=[finding("unsupported_claim", 7, 8)],
            ),
            patch(
                "app.routers.review.review_with_llm",
                return_value=[
                    finding("tone", 1, 3),
                    finding("messaging", 1, 2),
                    finding("unsupported_claim", 1, 3),
                ],
            ),
        ):
            result = review_content(
                1,
                x_user="test-user",
                role="creator",
                db=self.db,
            )

        self.assertEqual(
            [
                (item["start_offset"], item["end_offset"], item["check"])
                for item in result["findings"]
            ],
            [
                (1, 2, "messaging"),
                (1, 3, "tone"),
                (1, 3, "unsupported_claim"),
                (4, 5, "terminology"),
                (7, 8, "unsupported_claim"),
            ],
        )

    def test_database_failure_rolls_back_deletion_and_returns_contract_error(self):
        previous = self.add_finding(content_version=3, message="Old finding")

        with patch.object(self.db, "commit", side_effect=SQLAlchemyError("failure")):
            status, payload = self.request("/api/content/1/review")

        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "review_failed",
                "message": "Unable to save review findings.",
            },
        )
        persisted = self.db.query(Finding).all()
        self.assertEqual(
            [(item.id, item.content_version) for item in persisted],
            [(previous.id, 3)],
        )

    def test_accept_applies_suggested_fix_and_updates_versioned_offsets(self):
        content = self.db.get(Content, 1)
        content.body = "before old middle last"
        before = self.add_finding(
            check_type="messaging",
            message="Before replacement",
            start_offset=0,
            end_offset=6,
            matched_text="before",
        )
        target = self.add_finding(
            message="Target finding",
            start_offset=7,
            end_offset=10,
            matched_text="old",
            suggested_fix="new",
        )
        after = self.add_finding(
            check_type="unsupported_claim",
            message="After replacement",
            start_offset=18,
            end_offset=22,
            matched_text="last",
        )

        status, payload = self.request(
            f"/api/findings/{target.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(
            set(payload),
            {"content_id", "content_version", "finding"},
        )
        self.assertEqual(payload["content_id"], 1)
        self.assertEqual(payload["content_version"], 4)
        self.assertEqual(
            set(payload["finding"]),
            {
                "id",
                "check",
                "severity",
                "message",
                "evidence",
                "suggested_fix",
                "start_offset",
                "end_offset",
                "status",
            },
        )
        self.assertEqual(payload["finding"]["id"], target.id)
        self.assertEqual(payload["finding"]["status"], "accepted")
        self.assertEqual(payload["finding"]["start_offset"], 7)
        self.assertEqual(payload["finding"]["end_offset"], 10)
        self.assertEqual(payload["finding"]["evidence"]["matched_text"], "new")
        self.assertEqual(content.body, "before new middle last")
        self.assertEqual(content.version, 4)
        self.assertEqual(
            (before.start_offset, before.end_offset, before.content_version),
            (0, 6, 4),
        )
        self.assertEqual(
            (after.start_offset, after.end_offset, after.content_version),
            (18, 22, 4),
        )
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.content_id, content.id)
        self.assertEqual(event.actor, "test-user")
        self.assertEqual(event.action, "finding_accepted")
        self.assertEqual(event.details["finding_id"], target.id)
        self.assertEqual(event.details["previous_version"], 3)
        self.assertEqual(event.details["new_version"], 4)
        self.assertEqual(
            event.details["changes"],
            {"field": "text", "previous": "old", "next": "new"},
        )

    def test_edit_replaces_only_target_span_and_shifts_later_findings(self):
        content = self.db.get(Content, 1)
        content.body = "before old middle last"
        before = self.add_finding(
            check_type="messaging",
            message="Before replacement",
            start_offset=0,
            end_offset=6,
            matched_text="before",
        )
        target = self.add_finding(
            message="Target finding",
            start_offset=7,
            end_offset=10,
            matched_text="old",
            suggested_fix="suggested",
        )
        after = self.add_finding(
            check_type="unsupported_claim",
            message="After replacement",
            start_offset=18,
            end_offset=22,
            matched_text="last",
        )

        status, payload = self.request(
            f"/api/findings/{target.id}",
            method="PATCH",
            body={"action": "edit", "replacement": "longer"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["content_version"], 4)
        self.assertEqual(payload["finding"]["status"], "edited")
        self.assertEqual(payload["finding"]["start_offset"], 7)
        self.assertEqual(payload["finding"]["end_offset"], 13)
        self.assertEqual(content.body, "before longer middle last")
        self.assertEqual(content.version, 4)
        self.assertEqual(
            (before.start_offset, before.end_offset, before.content_version),
            (0, 6, 4),
        )
        self.assertEqual(
            (after.start_offset, after.end_offset, after.content_version),
            (21, 25, 4),
        )
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.action, "finding_edited")
        self.assertEqual(event.actor, "test-user")
        self.assertEqual(event.content_id, content.id)
        self.assertEqual(event.details["finding_id"], target.id)
        self.assertEqual(event.details["previous_version"], 3)
        self.assertEqual(event.details["new_version"], 4)
        self.assertEqual(
            event.details["changes"],
            {"field": "text", "previous": "old", "next": "longer"},
        )

    def test_edit_to_identical_text_does_not_increment_content_version(self):
        finding = self.add_finding(matched_text="best")
        content = self.db.get(Content, 1)
        original_body = content.body
        original_version = content.version

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "edit", "replacement": "best"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["content_version"], original_version)
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, original_version)
        self.assertEqual(finding.status, "edited")
        self.assertEqual(finding.content_version, original_version)
        self.assertEqual(self.db.query(AuditEvent).one().action, "finding_edited")
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.details["previous_version"], original_version)
        self.assertEqual(event.details["new_version"], original_version)
        self.assertNotIn("changes", event.details)

    def test_shorter_replacement_shifts_adjacent_findings_and_keeps_exact_spans(self):
        content = self.db.get(Content, 1)
        content.body = "beforeOLDafter"
        before = self.add_finding(
            check_type="messaging",
            message="Adjacent before",
            start_offset=0,
            end_offset=6,
            matched_text="before",
        )
        target = self.add_finding(
            start_offset=6,
            end_offset=9,
            matched_text="OLD",
            suggested_fix="x",
        )
        after = self.add_finding(
            check_type="unsupported_claim",
            message="Adjacent after",
            start_offset=9,
            end_offset=14,
            matched_text="after",
        )

        status, payload = self.request(
            f"/api/findings/{target.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["content_version"], 4)
        self.assertEqual(content.body, "beforexafter")
        self.assertEqual(content.version, 4)
        self.assertEqual(
            (before.start_offset, before.end_offset, before.content_version),
            (0, 6, 4),
        )
        self.assertEqual(
            (target.start_offset, target.end_offset, target.content_version),
            (6, 7, 4),
        )
        self.assertEqual(target.evidence["matched_text"], "x")
        self.assertEqual(
            (after.start_offset, after.end_offset, after.content_version),
            (7, 12, 4),
        )
        self.assertEqual(content.body[before.start_offset:before.end_offset], "before")
        self.assertEqual(content.body[target.start_offset:target.end_offset], "x")
        self.assertEqual(content.body[after.start_offset:after.end_offset], "after")

    def test_unverifiable_other_finding_remains_stale_in_prior_version(self):
        content = self.db.get(Content, 1)
        content.body = "old text"
        target = self.add_finding(
            start_offset=0,
            end_offset=3,
            matched_text="old",
            suggested_fix="new",
        )
        stale = self.add_finding(
            check_type="unsupported_claim",
            message="Legacy finding without span",
            start_offset=None,
            end_offset=None,
            matched_text="",
        )

        status, _ = self.request(
            f"/api/findings/{target.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(content.version, 4)
        self.assertEqual(content.body, "new text")
        self.assertEqual(stale.content_version, 3)
        self.assertIsNone(stale.start_offset)
        self.assertIsNone(stale.end_offset)

    def test_dismiss_changes_status_and_records_audit_without_editing_content(self):
        content = self.db.get(Content, 1)
        finding = self.add_finding()
        original_body = content.body
        original_version = content.version

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "dismiss"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(payload["finding"]["status"], "dismissed")
        self.assertEqual(payload["content_version"], original_version)
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, original_version)
        event = self.db.query(AuditEvent).one()
        self.assertEqual(event.action, "finding_dismissed")
        self.assertEqual(event.content_id, content.id)
        self.assertEqual(event.actor, "test-user")
        self.assertEqual(event.details["finding_id"], finding.id)
        self.assertEqual(event.details["previous_version"], original_version)
        self.assertEqual(event.details["new_version"], original_version)

    def test_invalid_action_or_edit_replacement_fails_without_changes(self):
        finding = self.add_finding(suggested_fix="correction")
        original_body = self.db.get(Content, 1).body

        for payload in (
            {"action": "replace"},
            {"action": "edit"},
            {"action": "edit", "replacement": "  "},
            {"action": "accept", "replacement": "not allowed"},
        ):
            with self.subTest(payload=payload):
                status, _ = self.request(
                    f"/api/findings/{finding.id}",
                    method="PATCH",
                    body=payload,
                )
                self.assertEqual(status, 422)
                self.assertEqual(self.db.get(Finding, finding.id).status, "open")
                self.assertEqual(self.db.get(Content, 1).body, original_body)
                self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_missing_finding_returns_contract_not_found_error(self):
        status, payload = self.request(
            "/api/findings/999",
            method="PATCH",
            body={"action": "dismiss"},
        )

        self.assertEqual(status, 404)
        self.assertEqual(
            payload,
            {"error": "not_found", "message": "Finding not found."},
        )

    def test_stale_offsets_fail_without_partial_updates(self):
        finding = self.add_finding(
            start_offset=2,
            end_offset=6,
            matched_text="best",
            suggested_fix="replacement",
        )
        content = self.db.get(Content, 1)
        original_body = content.body
        original_version = content.version

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "stale_finding")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, original_version)
        self.assertEqual(self.db.get(Finding, finding.id).status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_stale_content_version_fails_without_partial_updates(self):
        finding = self.add_finding(suggested_fix="great")
        content = self.db.get(Content, 1)
        content.version = 4
        self.db.commit()
        original_body = content.body

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "stale_finding")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, 4)
        self.assertEqual(self.db.get(Finding, finding.id).status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_older_version_finding_is_not_applied_to_current_content(self):
        finding = self.add_finding(
            content_version=2,
            suggested_fix="great",
        )
        content = self.db.get(Content, 1)
        original_body = content.body

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "stale_finding")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, 3)
        self.assertEqual(finding.status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_optimistic_version_conflict_rolls_back_action(self):
        finding = self.add_finding(suggested_fix="great")
        content = self.db.get(Content, 1)
        original_body = content.body
        original_version = content.version

        with patch(
            "app.routers.review.update",
            return_value=update(Content).where(Content.id == -1),
        ):
            status, payload = self.request(
                f"/api/findings/{finding.id}",
                method="PATCH",
                body={"action": "accept"},
            )

        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "stale_finding")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, original_version)
        self.assertEqual(finding.status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_finding_action_requires_audit_actor_header(self):
        finding = self.add_finding()

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "dismiss"},
            user=None,
        )

        self.assertEqual(status, 422)
        self.assertEqual(
            payload,
            {
                "error": "validation_error",
                "message": "The request data is invalid.",
            },
        )
        self.assertEqual(finding.status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_accept_without_suggested_fix_fails_without_changes(self):
        finding = self.add_finding()
        content = self.db.get(Content, 1)
        original_body = content.body

        status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "suggestion_unavailable")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, 3)
        self.assertEqual(self.db.get(Finding, finding.id).status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_findings_overlapping_replacement_are_rejected(self):
        content = self.db.get(Content, 1)
        content.body = "before old middle"
        self.db.commit()
        target = self.add_finding(
            start_offset=7,
            end_offset=10,
            matched_text="old",
            suggested_fix="new",
        )
        overlapping = self.add_finding(
            check_type="unsupported_claim",
            start_offset=8,
            end_offset=11,
            matched_text="ld ",
        )
        original_body = content.body

        status, payload = self.request(
            f"/api/findings/{target.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(status, 409)
        self.assertEqual(payload["error"], "overlapping_finding")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, 3)
        self.assertEqual(self.db.get(Finding, target.id).status, "open")
        self.assertEqual(self.db.get(Finding, overlapping.id).status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_finding_cannot_be_applied_twice(self):
        finding = self.add_finding(suggested_fix="great")
        status, _ = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "accept"},
        )
        self.assertEqual(status, 200)

        repeated_status, payload = self.request(
            f"/api/findings/{finding.id}",
            method="PATCH",
            body={"action": "accept"},
        )

        self.assertEqual(repeated_status, 409)
        self.assertEqual(payload["error"], "finding_resolved")
        self.assertEqual(self.db.query(AuditEvent).count(), 1)

    def test_finding_action_database_failure_rolls_back_content_and_audit(self):
        finding = self.add_finding(suggested_fix="great")
        content = self.db.get(Content, 1)
        original_body = content.body
        original_version = content.version

        with patch.object(self.db, "commit", side_effect=SQLAlchemyError("failure")):
            status, payload = self.request(
                f"/api/findings/{finding.id}",
                method="PATCH",
                body={"action": "accept"},
            )

        self.assertEqual(status, 500)
        self.assertEqual(payload["error"], "review_failed")
        self.assertEqual(content.body, original_body)
        self.assertEqual(content.version, original_version)
        self.assertEqual(self.db.get(Finding, finding.id).status, "open")
        self.assertEqual(self.db.query(AuditEvent).count(), 0)

    def test_review_operation_failure_rolls_back_replaced_findings(self):
        previous = self.add_finding(message="Must survive failed rerun")

        with patch(
            "app.routers.review.check_claims",
            side_effect=SQLAlchemyError("review query failed"),
        ):
            status, payload = self.request("/api/content/1/review")

        self.assertEqual(status, 500)
        self.assertEqual(
            payload,
            {
                "error": "review_failed",
                "message": "Unable to save review findings.",
            },
        )
        self.assertEqual(
            self.db.query(Finding).filter(Finding.id == previous.id).count(),
            1,
        )

    def test_schema_migration_adds_version_to_existing_findings(self):
        legacy_engine = create_engine("sqlite://")
        try:
            with legacy_engine.begin() as connection:
                connection.execute(
                    text(
                        "CREATE TABLE findings "
                        "(id INTEGER PRIMARY KEY, content_id INTEGER NOT NULL)"
                    )
                )
                connection.execute(
                    text(
                        "CREATE TABLE content "
                        "(id INTEGER PRIMARY KEY, title VARCHAR(250) NOT NULL, "
                        "body TEXT NOT NULL, status VARCHAR(50) NOT NULL, "
                        "version INTEGER NOT NULL, created_by VARCHAR(150) NOT NULL)"
                    )
                )
                connection.execute(
                    text("INSERT INTO findings (id, content_id) VALUES (1, 9)")
                )

            migrate_review_schema(legacy_engine)
            migrate_review_schema(legacy_engine)

            columns = {
                column["name"]
                for column in inspect(legacy_engine).get_columns("findings")
            }
            self.assertIn("content_version", columns)
            content_columns = {
                column["name"]
                for column in inspect(legacy_engine).get_columns("content")
            }
            self.assertTrue(
                {"content_type", "reviewed_version", "reviewed_at"}.issubset(
                    content_columns
                )
            )
            with legacy_engine.connect() as connection:
                self.assertEqual(
                    connection.execute(
                        text(
                            "SELECT content_version FROM findings WHERE id = 1"
                        )
                    ).scalar_one(),
                    1,
                )
        finally:
            legacy_engine.dispose()


if __name__ == "__main__":
    unittest.main()
