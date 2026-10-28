import asyncio
import json
import unittest

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import Asset, AuditEvent, Content, Fact, Guideline, Term
from app.routers import assets, facts, glossary, guidelines, seed


class KnowledgeEndpointTests(unittest.TestCase):
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
        for router in (
            guidelines.router,
            glossary.router,
            facts.router,
            assets.router,
            seed.router,
        ):
            self.app.include_router(router, prefix="/api")

        def override_get_db():
            with Session(self.engine) as db:
                yield db

        self.app.dependency_overrides[get_db] = override_get_db

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def request(self, method, path, *, role="brand_manager", body=None):
        async def dispatch():
            sent = []
            received = False
            request_body = b"" if body is None else json.dumps(body).encode()

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

            headers = [(b"x-role", role.encode("ascii"))]
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
                message["status"]
                for message in sent
                if message["type"] == "http.response.start"
            )
            response_body = b"".join(
                message.get("body", b"")
                for message in sent
                if message["type"] == "http.response.body"
            )
            return status, json.loads(response_body) if response_body else None

        return asyncio.run(dispatch())

    def test_collection_crud_uses_database_records_and_actual_schemas(self):
        cases = (
            (
                "/api/guidelines",
                {
                    "title": "Voice",
                    "description": "Be clear.",
                    "category": "tone",
                },
                {
                    "title": "Voice v2",
                    "description": "Be direct.",
                    "category": "tone",
                },
                {"id", "title", "description", "category"},
            ),
            (
                "/api/glossary",
                {
                    "term": "cheap",
                    "definition": "Suggests low quality.",
                    "preferredTerm": "affordable",
                    "status": "prohibited",
                    "guidelineId": None,
                },
                {
                    "term": "cheap",
                    "definition": "Avoid it.",
                    "preferredTerm": None,
                    "status": "approved",
                    "guidelineId": None,
                },
                {
                    "id",
                    "term",
                    "definition",
                    "preferredTerm",
                    "status",
                    "guidelineId",
                },
            ),
            (
                "/api/facts",
                {
                    "claim": "A verified claim.",
                    "owner": "Research",
                    "reviewDate": "2099-01-01",
                    "source": "Report A",
                    "lastReviewed": "2026-01-01",
                },
                {
                    "claim": "An updated claim.",
                    "owner": "Research",
                    "reviewDate": "2099-02-01",
                    "source": "Report B",
                    "lastReviewed": "2026-02-01",
                },
                {
                    "id",
                    "claim",
                    "owner",
                    "reviewDate",
                    "source",
                    "lastReviewed",
                    "outdated",
                },
            ),
            (
                "/api/assets",
                {
                    "name": "Logo",
                    "description": "Primary mark.",
                    "url": None,
                    "assetType": "logo",
                },
                {
                    "name": "Logo 2",
                    "description": "Updated mark.",
                    "url": None,
                    "assetType": "palette",
                },
                {"id", "name", "description", "url", "assetType"},
            ),
        )

        for path, create_body, update_body, fields in cases:
            with self.subTest(path=path):
                status, created = self.request("POST", path, body=create_body)
                self.assertEqual(status, 201)
                self.assertEqual(set(created), fields)

                status, listed = self.request("GET", path)
                self.assertEqual(status, 200)
                self.assertEqual(listed, [created])

                status, updated = self.request(
                    "PUT", f"{path}/{created['id']}", body=update_body
                )
                self.assertEqual(status, 200)
                self.assertEqual(set(updated), fields)
                for key, value in update_body.items():
                    self.assertEqual(updated[key], value)

                status, deleted = self.request(
                    "DELETE", f"{path}/{created['id']}"
                )
                self.assertEqual(status, 204)
                self.assertIsNone(deleted)

        knowledge_events = (
            self.db.query(AuditEvent)
            .filter(AuditEvent.action.like("knowledge_%"))
            .all()
        )
        self.assertEqual(len(knowledge_events), 12)
        self.assertTrue(
            all(
                event.content_id is None
                and event.details["actor_role"] == "brand_manager"
                for event in knowledge_events
            )
        )

    def test_knowledge_writes_and_seed_are_restricted_by_backend_role(self):
        status, payload = self.request(
            "POST",
            "/api/guidelines",
            role="reviewer",
            body={"title": "Blocked", "description": "Not allowed."},
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "forbidden")
        self.assertEqual(self.db.query(Guideline).count(), 0)

        status, payload = self.request(
            "POST",
            "/api/seed/load",
            role="creator",
        )
        self.assertEqual(status, 403)
        self.assertEqual(payload["error"], "forbidden")

    def test_sample_seed_is_repeatable_and_preserves_unrelated_records(self):
        self.db.add(
            Guideline(title="User-owned guideline", description="Keep this rule.")
        )
        self.db.add(
            Content(
                id=1,
                title="User content",
                body="Do not replace.",
                status="draft",
                version=1,
                created_by="another-user",
            )
        )
        self.db.commit()

        status, first = self.request("POST", "/api/seed/load")
        self.assertEqual(status, 200)
        def record_counts():
            return tuple(
                self.db.query(model).count()
                for model in (Guideline, Term, Fact, Asset, Content)
            )

        first_counts = record_counts()

        status, second = self.request("POST", "/api/seed/load")
        self.assertEqual(status, 200)
        self.assertEqual(second["sample_content_id"], first["sample_content_id"])
        self.assertEqual(record_counts(), first_counts)
        self.assertIsNotNone(self.db.get(Content, 1))
        self.assertEqual(self.db.get(Content, 1).body, "Do not replace.")
        self.assertEqual(
            self.db.query(AuditEvent)
            .filter(AuditEvent.action == "sample_brand_loaded")
            .count(),
            2,
        )

    def test_term_guideline_link_is_validated_and_cleared_on_guideline_delete(self):
        status, guideline = self.request(
            "POST",
            "/api/guidelines",
            body={
                "title": "Claims",
                "description": "Support claims with evidence.",
                "category": "claims",
            },
        )
        self.assertEqual(status, 201)

        status, term = self.request(
            "POST",
            "/api/glossary",
            body={
                "term": "guaranteed",
                "definition": "Avoid unsupported promises.",
                "preferredTerm": None,
                "status": "prohibited",
                "guidelineId": guideline["id"],
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(term["guidelineId"], guideline["id"])

        status, _ = self.request(
            "DELETE",
            f"/api/guidelines/{guideline['id']}",
        )
        self.assertEqual(status, 204)
        status, terms = self.request("GET", "/api/glossary")
        self.assertEqual(status, 200)
        self.assertIsNone(next(item for item in terms if item["id"] == term["id"])["guidelineId"])


if __name__ == "__main__":
    unittest.main()
