import asyncio
import json
import unittest

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import Guideline
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
                {"title": "Voice", "description": "Be clear."},
                {"title": "Voice v2", "description": "Be direct."},
                {"id", "title", "description"},
            ),
            (
                "/api/glossary",
                {
                    "term": "cheap",
                    "definition": "Suggests low quality.",
                    "preferredTerm": "affordable",
                },
                {
                    "term": "cheap",
                    "definition": "Avoid it.",
                    "preferredTerm": None,
                },
                {"id", "term", "definition", "preferredTerm"},
            ),
            (
                "/api/facts",
                {
                    "claim": "A verified claim.",
                    "owner": "Research",
                    "reviewDate": "2099-01-01",
                },
                {
                    "claim": "An updated claim.",
                    "owner": "Research",
                    "reviewDate": "2099-02-01",
                },
                {"id", "claim", "owner", "reviewDate", "outdated"},
            ),
            (
                "/api/assets",
                {"name": "Logo", "description": "Primary mark.", "url": None},
                {"name": "Logo 2", "description": "Updated mark.", "url": None},
                {"id", "name", "description", "url"},
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


if __name__ == "__main__":
    unittest.main()
