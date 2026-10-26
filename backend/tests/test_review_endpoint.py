import asyncio
import json
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db, migrate_review_schema
from app.exception_handlers import register_exception_handlers
from app.models import Content, Finding, Term
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
                    created_by="test",
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

    def request(self, path):
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
            await self.app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0", "spec_version": "2.3"},
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "http",
                    "path": path,
                    "raw_path": raw_path,
                    "query_string": b"",
                    "headers": [],
                    "client": ("testclient", 123),
                    "server": ("testserver", 80),
                },
                receive,
                send,
            )
            status = next(
                message["status"]
                for message in sent
                if message["type"] == "http.response.start"
            )
            body = b"".join(
                message.get("body", b"")
                for message in sent
                if message["type"] == "http.response.body"
            )
            return status, json.loads(body)

        return asyncio.run(dispatch())

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
            result = review_content(1, self.db)

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
        previous = Finding(
            content_id=1,
            content_version=2,
            check_type="tone",
            severity="warning",
            message="Old finding",
            evidence={},
            start_offset=0,
            end_offset=1,
        )
        self.db.add(previous)
        self.db.commit()

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
            [(previous.id, 2)],
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
                    text("INSERT INTO findings (id, content_id) VALUES (1, 9)")
                )

            migrate_review_schema(legacy_engine)
            migrate_review_schema(legacy_engine)

            columns = {
                column["name"]
                for column in inspect(legacy_engine).get_columns("findings")
            }
            self.assertIn("content_version", columns)
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
