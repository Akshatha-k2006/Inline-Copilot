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
    "sourceType",
    "sourceUrl",
    "documentName",
    "documentType",
    "attachedBy",
    "attachedAt",
    "verifiedBy",
    "verifiedAt",
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


class AttachEvidenceTests(unittest.TestCase):
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
            request = EvidenceRequest(
                finding_id=finding.id,
                claim_text="Blocks ads for a wide audience.",
                reason="Need approval proof before publishing.",
                assignee="Ravi (Reviewer)",
                status="open",
            )
            db.add(request)
            db.commit()
            self.request_id = request.id

    def tearDown(self):
        self.engine.dispose()

    def fetch_item(self):
        response = self.client.get(
            "/api/evidence-requests", headers={"X-Role": "reviewer"}
        )
        self.assertEqual(response.status_code, 200)
        items = [i for i in response.json() if i["id"] == self.request_id]
        self.assertEqual(len(items), 1)
        return items[0]

    def attach(self, payload, request_id=None):
        return self.client.post(
            f"/api/evidence-requests/{request_id or self.request_id}/evidence",
            headers={"X-Role": "brand_manager"},
            json=payload,
        )

    def test_attach_url_source_happy_path(self):
        response = self.attach(
            {
                "sourceType": "url",
                "sourceUrl": " https://luminahome.com/report ",
            }
        )
        self.assertEqual(response.status_code, 200)
        item = self.fetch_item()
        self.assertEqual(item["sourceType"], "url")
        self.assertEqual(item["sourceUrl"], "https://luminahome.com/report")
        self.assertIsNone(item["documentName"])
        self.assertIsNone(item["documentType"])
        self.assertEqual(item["attachedBy"], "brand_manager")
        datetime.fromisoformat(item["attachedAt"])
        self.assertEqual(item["status"], "open")
        self.assertIsNone(item["verifiedBy"])
        self.assertIsNone(item["verifiedAt"])

    def test_attach_document_source_happy_path(self):
        response = self.attach(
            {
                "sourceType": "document",
                "documentName": "Brand-safety-guidelines",
                "documentType": "pdf",
            }
        )
        self.assertEqual(response.status_code, 200)
        item = self.fetch_item()
        self.assertEqual(item["sourceType"], "document")
        self.assertEqual(item["documentName"], "Brand-safety-guidelines")
        self.assertEqual(item["documentType"], "pdf")
        self.assertIsNone(item["sourceUrl"])
        self.assertEqual(item["status"], "open")

    def test_attach_url_requires_valid_url(self):
        for source_url in ("", "not a url", "ftp://example.com/file"):
            with self.subTest(sourceUrl=source_url):
                response = self.attach(
                    {"sourceType": "url", "sourceUrl": source_url}
                )
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["error"], "validation_error")
        self.assertIsNone(self.fetch_item()["sourceType"])

    def test_attach_document_shape_is_validated(self):
        cases = (
            {"sourceType": "document", "documentName": "Guidelines"},
            {
                "sourceType": "document",
                "documentName": "Guidelines",
                "documentType": "exe",
            },
            {
                "sourceType": "url",
                "sourceUrl": "https://example.com/page",
                "documentName": "Guidelines",
            },
        )
        for payload in cases:
            with self.subTest(payload=payload):
                response = self.attach(payload)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()["error"], "validation_error")
        self.assertIsNone(self.fetch_item()["sourceType"])

    def test_attach_unknown_request_returns_404(self):
        response = self.attach(
            {"sourceType": "url", "sourceUrl": "https://example.com/page"},
            request_id=999999,
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"], "not_found")

    def test_attach_keeps_request_open_and_audits(self):
        response = self.attach(
            {"sourceType": "url", "sourceUrl": "https://example.com/page"}
        )
        self.assertEqual(response.status_code, 200)
        with Session(self.engine) as db:
            event = (
                db.query(AuditEvent)
                .filter(AuditEvent.action == "evidence_request_attached")
                .one()
            )
            self.assertEqual(event.details["evidence_request_id"], self.request_id)
            self.assertEqual(event.details["source_type"], "url")
        self.assertEqual(self.fetch_item()["status"], "open")

    def test_reattach_overwrites_single_slot(self):
        first = self.attach(
            {"sourceType": "url", "sourceUrl": "https://example.com/page"}
        )
        self.assertEqual(first.status_code, 200)
        second = self.attach(
            {
                "sourceType": "document",
                "documentName": "Guidelines",
                "documentType": "docx",
            }
        )
        self.assertEqual(second.status_code, 200)
        item = self.fetch_item()
        self.assertEqual(item["sourceType"], "document")
        self.assertEqual(item["documentName"], "Guidelines")
        self.assertEqual(item["documentType"], "docx")
        self.assertIsNone(item["sourceUrl"])


if __name__ == "__main__":
    unittest.main()
