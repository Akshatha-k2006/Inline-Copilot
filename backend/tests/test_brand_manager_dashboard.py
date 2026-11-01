import unittest
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.models import Content, Finding, FindingDecisionEvent, Guideline
from app.routers import brand_manager


class BrandManagerDashboardTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.app = FastAPI()
        self.app.include_router(brand_manager.router, prefix="/api")

        def override_get_db():
            with Session(self.engine) as db:
                yield db

        self.app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(self.app)

        with Session(self.engine) as db:
            guideline = Guideline(
                title="Voice",
                description="Be clear.",
                category="tone",
            )
            content = Content(
                title="Draft",
                body="Text",
                status="draft",
                created_by="Asha (Creator)",
            )
            db.add_all([guideline, content])
            db.flush()
            finding = Finding(
                content_id=content.id,
                content_version=1,
                guideline_id=guideline.id,
                check_type="tone",
                message="Too vague",
            )
            db.add(finding)
            db.flush()
            db.add(
                FindingDecisionEvent(
                    event_key="finding:1:dismissed",
                    finding_id=finding.id,
                    finding_reference_id=finding.id,
                    content_id=content.id,
                    guideline_id=guideline.id,
                    guideline_title=guideline.title,
                    decision="dismissed",
                    actor="Ravi (Reviewer)",
                    details={"dismissal_reason": "Intentional"},
                    occurred_at=datetime.now(timezone.utc),
                )
            )
            db.commit()

    def tearDown(self):
        self.engine.dispose()

    def test_brand_manager_metrics_are_derived_and_grouped(self):
        response = self.client.get(
            "/api/brand-manager/dashboard?days=30",
            headers={"X-Role": "brand_manager"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["overview"]["active_guidelines"], 1)
        self.assertEqual(body["overview"]["findings"], 1)
        self.assertEqual(body["findings_per_rule"][0]["finding_count"], 1)
        self.assertEqual(body["frequently_dismissed"][0]["dismissal_rate"], 1.0)
        self.assertEqual(len(body["clarifications"]), 1)

    def test_non_brand_manager_is_forbidden(self):
        response = self.client.get(
            "/api/brand-manager/dashboard",
            headers={"X-Role": "creator"},
        )
        self.assertEqual(response.status_code, 403)
