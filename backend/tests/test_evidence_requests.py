import unittest
from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import AuditEvent, Content, EvidenceRequest, Finding
from app.routers import evidence_requests

RESPONSE_KEYS = {
    "id",
    "claimText",
    "findingId",
    "reason",
    "assignee",
    "status",
    "createdAt",
    "updatedAt",
}


def build_client(engine):
    app = FastAPI()
    register_exception_handlers(app)
    app.include_router(evidence_requests.router, prefix="/api")

    def override_get_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app, raise_server_exceptions=False)


class EvidenceRequestEndpointTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.client = build_client(self.engine)
        with Session(self.engine) as db:
            content = Content(
                title="Landing page",
                body="Visit our site for a wide audience.",
                created_by="Asha (Creator)",
            )
            db.add(content)
            db.flush()
            self.content_id = content.id
            claim_finding = Finding(
                content_id=content.id,
                content_version=1,
                check_type="unsupported_claim",
                severity="warning",
                message='The claim "Blocks ads for a wide audience." is not supported by a stored fact.',
                evidence={"fact_id": None},
            )
            terminology_finding = Finding(
                content_id=content.id,
                content_version=1,
                check_type="terminology",
                severity="warning",
                message="The word 'cheap' is prohibited; use 'budget-friendly'.",
                evidence={},
            )
            db.add(claim_finding)
            db.add(terminology_finding)
            db.commit()
            self.claim_finding_id = claim_finding.id
            self.terminology_finding_id = terminology_finding.id

    def tearDown(self):
        self.engine.dispose()

    def create_payload(self, **overrides):
        payload = {
            "claimText": "Blocks ads for a wide audience.",
            "findingId": self.claim_finding_id,
            "reason": "Need approval proof from the brand team before publishing.",
            "assignee": "Ravi (Reviewer)",
        }
        payload.update(overrides)
        return payload

    def test_create_returns_201_with_response_shape(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(
                claimText="  Blocks ads for a wide audience.  "
            ),
        )
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(set(body.keys()), RESPONSE_KEYS)
        self.assertEqual(
            body["claimText"], "Blocks ads for a wide audience."
        )
        self.assertEqual(body["findingId"], self.claim_finding_id)
        self.assertEqual(
            body["reason"],
            "Need approval proof from the brand team before publishing.",
        )
        self.assertEqual(body["assignee"], "Ravi (Reviewer)")
        self.assertEqual(body["status"], "open")
        self.assertTrue(body["id"] > 0)
        created_at = datetime.fromisoformat(body["createdAt"])
        updated_at = datetime.fromisoformat(body["updatedAt"])
        self.assertEqual(created_at, updated_at)

    def test_create_unknown_finding_returns_404(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(findingId=999999),
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "not_found")

        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(findingId="abc"),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")

    def test_create_for_non_claim_finding_returns_422(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(findingId=self.terminology_finding_id),
        )
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["error"], "validation_error")
        self.assertIn("unsupported_claim", body["message"])

    def test_create_blank_fields_returns_422(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(claimText="   "),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")

    def test_create_over_length_assignee_returns_422(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(assignee="R" * 151),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")

    def test_create_unknown_assignee_returns_422(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(assignee="Unassigned"),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")

    def test_create_claim_mismatch_returns_422_when_finding_has_claim_text(self):
        with Session(self.engine) as db:
            finding = db.get(Finding, self.claim_finding_id)
            finding.evidence = {"matched_text": "The stored claim."}
            db.commit()

        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "creator"},
            json=self.create_payload(),
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")

    def test_create_writes_audit_event(self):
        response = self.client.post(
            "/api/evidence-requests",
            headers={"X-Role": "reviewer"},
            json=self.create_payload(),
        )
        self.assertEqual(response.status_code, 201)
        request_id = response.json()["id"]
        with Session(self.engine) as db:
            event = (
                db.query(AuditEvent)
                .filter(AuditEvent.action == "evidence_request_created")
                .one()
            )
            self.assertIsNone(event.content_id)
            self.assertEqual(event.actor, "reviewer")
            self.assertEqual(event.details["finding_id"], self.claim_finding_id)
            self.assertEqual(event.details["assignee"], "Ravi (Reviewer)")
            self.assertEqual(event.details["actor_role"], "reviewer")
            self.assertEqual(
                event.details.get("evidence_request_id"),
                request_id,
            )


class ListEvidenceRequestTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.client = build_client(self.engine)
        with Session(self.engine) as db:
            content = Content(
                title="Landing page",
                body="Visit our site for a wide audience.",
                created_by="Asha (Creator)",
            )
            db.add(content)
            db.flush()
            finding = Finding(
                content_id=content.id,
                content_version=1,
                check_type="unsupported_claim",
                severity="warning",
                message="An unsupported claim.",
                evidence={},
            )
            db.add(finding)
            db.flush()
            self.finding_id = finding.id
            rows = (
                EvidenceRequest(
                    finding_id=finding.id,
                    claim_text="Claim A.",
                    reason="Reason A.",
                    assignee="Ravi (Reviewer)",
                    status="open",
                ),
                EvidenceRequest(
                    finding_id=finding.id,
                    claim_text="Claim B.",
                    reason="Reason B.",
                    assignee="Bhavana (Brand Manager)",
                    status="dismissed",
                ),
                EvidenceRequest(
                    finding_id=finding.id,
                    claim_text="Claim C.",
                    reason="Reason C.",
                    assignee="Bhavana (Brand Manager)",
                    status="open",
                ),
            )
            for row in rows:
                db.add(row)
            db.commit()

    def tearDown(self):
        self.engine.dispose()

    def request_ids(self, body):
        return [item["id"] for item in body]

    def test_list_requests_are_ordered_and_unfiltered(self):
        response = self.client.get(
            "/api/evidence-requests", headers={"X-Role": "reviewer"}
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 3)
        ids = self.request_ids(body)
        self.assertEqual(ids, sorted(ids))
        for item in body:
            self.assertEqual(set(item.keys()), RESPONSE_KEYS)
        self.assertEqual(body[0]["claimText"], "Claim A.")
        self.assertEqual(body[1]["claimText"], "Claim B.")
        self.assertEqual(body[2]["claimText"], "Claim C.")

    def test_filter_by_status(self):
        response = self.client.get(
            "/api/evidence-requests",
            headers={"X-Role": "reviewer"},
            params={"status": "dismissed"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            [(item["status"], item["claimText"]) for item in body],
            [("dismissed", "Claim B.")],
        )

    def test_filter_by_assignee(self):
        response = self.client.get(
            "/api/evidence-requests",
            headers={"X-Role": "reviewer"},
            params={"assignee": "Ravi (Reviewer)"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            [(item["assignee"], item["claimText"]) for item in body],
            [("Ravi (Reviewer)", "Claim A.")],
        )

    def test_filter_by_finding_id(self):
        response = self.client.get(
            "/api/evidence-requests",
            headers={"X-Role": "reviewer"},
            params={"findingId": self.finding_id},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 3)

    def test_filters_combine(self):
        response = self.client.get(
            "/api/evidence-requests",
            headers={"X-Role": "reviewer"},
            params={"status": "open", "assignee": "Bhavana (Brand Manager)"},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            [(item["status"], item["assignee"]) for item in body],
            [("open", "Bhavana (Brand Manager)")],
        )

    def test_filter_unknown_status_returns_422(self):
        response = self.client.get(
            "/api/evidence-requests",
            headers={"X-Role": "reviewer"},
            params={"status": "wat"},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")


if __name__ == "__main__":
    unittest.main()
