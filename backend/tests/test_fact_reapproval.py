import unittest
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import AuditEvent, Fact
from app.routers import facts


def build_client(engine):
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(facts.router, prefix="/api")

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app, raise_server_exceptions=False)


def dt(value):
    return datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)


class FactReapproveTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.client = build_client(self.engine)
        self.today = datetime.now(timezone.utc).date()
        with Session(self.engine) as db:
            self.expired_fact = Fact(
                statement="The brand serves 10,000 households.",
                owner="Bhavana (Brand Manager)",
                source="Annual report",
                last_reviewed=None,
                review_by=dt(self.today - timedelta(days=30)),
            )
            db.add(self.expired_fact)
            db.commit()
            self.fact_id = self.expired_fact.id

    def tearDown(self):
        self.engine.dispose()

    def fetch_fact(self, fact_id):
        response = self.client.get(
            "/api/facts", headers={"X-Role": "brand_manager"}
        )
        self.assertEqual(response.status_code, 200)
        items = [i for i in response.json() if i["id"] == fact_id]
        self.assertEqual(len(items), 1)
        return items[0]

    def reapprove(self, fact_id, role="brand_manager", body=None):
        return self.client.put(
            f"/api/facts/{fact_id}/re-approve",
            headers={"X-Role": role, "Content-Type": "application/json"},
            json=body if body is not None else {"reviewDate": "2099-12-31"},
        )

    def test_reapprove_expires_fact_becomes_current(self):
        future = (self.today + timedelta(days=365)).isoformat()
        response = self.reapprove(self.fact_id, body={"reviewDate": future})
        self.assertEqual(response.status_code, 200)
        item = self.fetch_fact(self.fact_id)
        self.assertFalse(item["outdated"])
        self.assertEqual(item["reviewDate"], future)
        self.assertEqual(
            item["lastReviewed"], self.today.isoformat()
        )

    def test_reapprove_past_expiry_returns_422(self):
        yesterday = (self.today - timedelta(days=1)).isoformat()
        response = self.reapprove(self.fact_id, body={"reviewDate": yesterday})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")
        item = self.fetch_fact(self.fact_id)
        self.assertEqual(
            item["reviewDate"],
            (self.today - timedelta(days=30)).isoformat(),
        )
        self.assertTrue(item["outdated"])

    def test_reapprove_requires_review_date(self):
        response = self.reapprove(self.fact_id, body={})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")

    def test_reapprove_non_writer_returns_403(self):
        for role in ("creator", "reviewer"):
            with self.subTest(role=role):
                response = self.reapprove(self.fact_id, role=role)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["error"], "forbidden")
        item = self.fetch_fact(self.fact_id)
        self.assertTrue(item["outdated"])
        self.assertIsNone(item["lastReviewed"])

    def test_reapprove_unknown_fact_returns_404(self):
        response = self.reapprove(999999)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "not_found")

    def test_reapprove_writes_distinct_audit_event(self):
        future = (self.today + timedelta(days=365)).isoformat()
        response = self.reapprove(self.fact_id, body={"reviewDate": future})
        self.assertEqual(response.status_code, 200)
        with Session(self.engine) as db:
            event = (
                db.query(AuditEvent)
                .filter(AuditEvent.action == "knowledge_fact_reapproved")
                .one()
            )
            self.assertEqual(event.actor, "brand_manager")
            self.assertEqual(event.details["actor_role"], "brand_manager")
            self.assertEqual(event.details["resource_type"], "fact")
            self.assertEqual(event.details["resource_id"], self.fact_id)


if __name__ == "__main__":
    unittest.main()
