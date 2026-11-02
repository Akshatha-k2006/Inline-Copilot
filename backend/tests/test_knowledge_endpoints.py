import asyncio
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import (
    Asset,
    AuditEvent,
    Comment,
    Content,
    ContentImage,
    EvidenceRequest,
    Fact,
    Finding,
    FindingDecisionEvent,
    FindingReviewEvent,
    Guideline,
    Term,
)
from app.routers import assets, facts, glossary, guidelines, seed
from app.services.accessibility_checker import check_contrast
from app.services.startup import (
    INITIAL_SAMPLE_SETUP_ACTION,
    initialize_sample_workspace,
)


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

    def test_initial_startup_keeps_only_sample_once(self):
        self.db.add_all(
            [
                Content(
                    title="Old draft",
                    content_type="marketing_copy",
                    body="Old content.",
                    status="draft",
                    version=1,
                    created_by="Asha",
                ),
                Content(
                    title="Another draft",
                    content_type="marketing_copy",
                    body="More content.",
                    status="draft",
                    version=1,
                    created_by="Asha",
                ),
            ]
        )
        self.db.commit()

        self.assertTrue(initialize_sample_workspace(self.db))
        self.db.expire_all()

        documents = self.db.query(Content).all()
        self.assertEqual(len(documents), 1)
        self.assertEqual(documents[0].title, "Spring launch post (sample)")
        sample_image = self.db.query(ContentImage).one()
        self.assertTrue(Path(sample_image.storage_path).is_file())
        self.assertEqual(
            Path(sample_image.storage_path),
            seed.SEED_FILE.parent / "lumina-sample-product.png",
        )
        self.assertEqual(
            self.db.query(AuditEvent)
            .filter(AuditEvent.action == "initial_sample_data_sync_v1")
            .count(),
            1,
        )
        self.assertEqual(
            self.db.query(AuditEvent)
            .filter(AuditEvent.action == "initial_sample_workspace_setup")
            .count(),
            1,
        )

        later_document = Content(
            title="Created after initialization",
            content_type="marketing_copy",
            body="Later content.",
            status="draft",
            version=1,
            created_by="Asha",
        )
        self.db.add(later_document)
        self.db.commit()

        self.assertFalse(initialize_sample_workspace(self.db))
        self.assertEqual(self.db.query(Content).count(), 2)

    def test_initial_startup_updates_legacy_sample_and_repairs_image_path(self):
        sample = Content(
            title="Spring launch post (sample)",
            content_type="social_media",
            body="Old deployed sample text.",
            status="draft",
            version=1,
            created_by="Asha",
        )
        self.db.add(sample)
        self.db.flush()
        image = ContentImage(
            content_id=sample.id,
            filename="lumina-sample-product.png",
            mime_type="image/png",
            storage_path="old-deployment/uploads/missing.png",
            alt_text="Old image data",
        )
        self.db.add(image)
        self.db.add_all(
            [
                AuditEvent(
                    actor="system",
                    action="initial_sample_workspace_setup",
                    details={"sample_content_id": sample.id, "removed_content": 0},
                ),
                AuditEvent(
                    actor="system",
                    action="initial_sample_draft_reset",
                    details={"sample_content_id": sample.id},
                ),
            ]
        )
        self.db.commit()

        self.assertFalse(initialize_sample_workspace(self.db))
        self.db.refresh(sample)
        self.db.refresh(image)

        with seed.SEED_FILE.open("r", encoding="utf-8") as file:
            fixture = json.load(file)
        self.assertEqual(sample.body, fixture["sample_draft"]["body"])
        self.assertEqual(sample.version, 2)
        self.assertEqual(sample.status, "draft")
        self.assertIsNone(sample.reviewed_version)
        self.assertEqual(
            Path(image.storage_path),
            seed.SEED_FILE.parent / fixture["demo_image"]["source_file"],
        )
        self.assertTrue(Path(image.storage_path).is_file())

    def test_initial_startup_resets_existing_sample_to_draft_once(self):
        sample = Content(
            title="Spring launch post (sample)",
            content_type="social_media",
            body="Sample content.",
            status="in_review",
            version=2,
            reviewed_version=2,
            created_by="Asha",
        )
        self.db.add(sample)
        self.db.flush()
        self.db.add(
            AuditEvent(
                actor="system",
                action=INITIAL_SAMPLE_SETUP_ACTION,
                details={"sample_content_id": sample.id, "removed_content": 0},
            )
        )
        self.db.commit()

        self.assertFalse(initialize_sample_workspace(self.db))
        self.db.refresh(sample)
        self.assertEqual(sample.status, "draft")
        self.assertIsNone(sample.reviewed_version)
        self.assertIsNone(sample.reviewed_at)

        sample.status = "in_review"
        self.db.commit()
        self.assertFalse(initialize_sample_workspace(self.db))
        self.db.refresh(sample)
        self.assertEqual(sample.status, "in_review")

    def request(self, method, path, *, role="brand_manager", body=None):
        async def dispatch():
            parsed_path = urlsplit(path)
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
                    "path": parsed_path.path,
                    "raw_path": parsed_path.path.encode("ascii"),
                    "query_string": parsed_path.query.encode("ascii"),
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

    def test_creator_reset_restores_pristine_sample_after_approval(self):
        sample = Content(
            title="Spring launch post (sample)",
            content_type="social_media",
            body="affordable and affordable",
            status="approved",
            version=3,
            reviewed_version=3,
            created_by="Asha",
        )
        self.db.add(sample)
        self.db.flush()
        finding = Finding(
            content_id=sample.id,
            content_version=3,
            check_type="terminology",
            severity="medium",
            message="Old demo finding.",
            evidence={"matched_text": "affordable"},
        )
        self.db.add(finding)
        self.db.flush()
        self.db.add_all(
            [
                EvidenceRequest(
                    finding_id=finding.id,
                    claim_text="affordable",
                    reason="Old demo evidence request.",
                    assignee="Ravi",
                ),
                Comment(
                    content_id=sample.id,
                    author="Ravi",
                    body="Old demo feedback.",
                ),
                ContentImage(
                    content_id=sample.id,
                    filename="old-upload.png",
                    mime_type="image/png",
                    storage_path="missing-user-upload.png",
                ),
            ]
        )
        self.db.commit()

        status, response = self.request(
            "POST",
            "/api/demo/reset-sample",
            role="creator",
        )

        self.assertEqual(status, 200)
        self.db.expire_all()
        self.db.refresh(sample)
        with seed.SEED_FILE.open("r", encoding="utf-8") as file:
            fixture = json.load(file)
        self.assertEqual(sample.body, fixture["sample_draft"]["body"])
        self.assertEqual(sample.status, "draft")
        self.assertEqual(sample.version, 4)
        self.assertIsNone(sample.reviewed_version)
        self.assertEqual(self.db.query(Finding).count(), 0)
        self.assertEqual(self.db.query(EvidenceRequest).count(), 0)
        self.assertEqual(self.db.query(Comment).count(), 0)
        image = self.db.query(ContentImage).one()
        self.assertEqual(image.id, response["image_id"])
        self.assertEqual(
            Path(image.storage_path),
            seed.SEED_FILE.parent / fixture["demo_image"]["source_file"],
        )
        self.assertEqual(response["content_id"], sample.id)

        repeated_status, repeated_response = self.request(
            "POST",
            "/api/demo/reset-sample",
            role="creator",
        )
        self.assertEqual(repeated_status, 200)
        self.assertEqual(repeated_response["content_version"], sample.version)
        self.assertEqual(self.db.query(ContentImage).count(), 1)

        denied_status, denied = self.request(
            "POST",
            "/api/demo/reset-sample",
            role="reviewer",
        )
        self.assertEqual(denied_status, 403)
        self.assertEqual(denied["error"], "forbidden")

    def test_sample_seed_keeps_only_one_document_and_removes_legacy_demo_request(self):
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
        sample_content = Content(
            id=2,
            title="Spring launch post (sample)",
            content_type="social_media",
            body=(
                "Meet LuminaBulbs, the #1 best smart bulbs on the planet! "
                "They will definitely cut your energy bill by 90%."
            ),
            status="in_review",
            version=1,
            reviewed_version=1,
            created_by="Asha",
        )
        self.db.add(sample_content)
        self.db.flush()
        legacy_finding = Finding(
            content_id=sample_content.id,
            content_version=1,
            check_type="unsupported_claim",
            severity="warning",
            message=(
                'The claim "#1 best smart bulbs on the planet" is not supported '
                "by approved brand evidence."
            ),
            evidence={"matched_text": "#1 best smart bulbs on the planet"},
            start_offset=21,
            end_offset=51,
            status="resolved",
        )
        other_finding = Finding(
            content_id=1,
            content_version=1,
            check_type="unsupported_claim",
            severity="warning",
            message="A user finding.",
            evidence={"matched_text": "User content"},
            start_offset=0,
            end_offset=12,
            status="open",
        )
        self.db.add_all([legacy_finding, other_finding])
        self.db.flush()
        self.db.add_all(
            [
                EvidenceRequest(
                    finding_id=legacy_finding.id,
                    claim_text="#1 best smart bulbs on the planet",
                    reason=(
                        "Provide approved comparative evidence before this "
                        "superlative claim can be published."
                    ),
                    assignee="Ravi (Reviewer)",
                    status="open",
                ),
                EvidenceRequest(
                    finding_id=other_finding.id,
                    claim_text="User content",
                    reason="A user request.",
                    assignee="Ravi (Reviewer)",
                    status="open",
                ),
            ]
        )
        self.db.add(
            Comment(content_id=1, author="another-user", body="Keep no orphan.")
        )
        self.db.commit()

        status, first = self.request("POST", "/api/seed/load")
        self.assertEqual(status, 200)
        self.db.expire_all()

        def record_counts():
            return tuple(
                self.db.query(model).count()
                for model in (
                    Guideline,
                    Term,
                    Fact,
                    Asset,
                    Content,
                    ContentImage,
                    Finding,
                    EvidenceRequest,
                )
            )

        first_counts = record_counts()
        self.assertEqual(first["counts"]["images"], 1)
        self.assertEqual(first["counts"]["content"], 1)
        self.assertEqual(first["counts"]["evidence_requests"], 0)
        self.assertEqual(first["counts"]["removed_content"], 1)
        self.assertEqual(self.db.query(Finding).count(), 0)
        self.assertEqual(self.db.query(EvidenceRequest).count(), 0)
        self.assertEqual(self.db.query(Comment).count(), 0)
        self.assertEqual(
            self.db.query(Asset)
            .filter(
                Asset.asset_type == "palette",
                Asset.description.contains("#F2A93B"),
            )
            .count(),
            1,
        )
        contrast_result = check_contrast(
            self.db, "#F2A93B", "#FAF8F3", "normal"
        )
        self.assertEqual(
            contrast_result["brand_palette_match"],
            {"foreground": True, "background": True},
        )
        sample_content = self.db.get(Content, first["sample_content_id"])
        self.assertEqual(sample_content.status, "draft")
        self.assertIsNone(sample_content.reviewed_version)
        self.assertEqual(sample_content.foreground_color, "#26323B")
        self.assertEqual(sample_content.background_color, "#FAF8F3")
        with seed.SEED_FILE.open("r", encoding="utf-8") as file:
            fixture = json.load(file)
        self.assertEqual(sample_content.body, fixture["sample_draft"]["body"])
        sample_documents = (
            self.db.query(Content)
            .filter(
                Content.title == "Spring launch post (sample)",
                Content.created_by == "Asha",
            )
            .all()
        )
        self.assertEqual(len(sample_documents), 1)
        sample_image = (
            self.db.query(ContentImage)
            .filter(ContentImage.content_id == sample_content.id)
            .one()
        )
        self.assertTrue(Path(sample_image.storage_path).is_file())
        self.assertEqual(
            Path(sample_image.storage_path),
            seed.SEED_FILE.parent / fixture["demo_image"]["source_file"],
        )

        status, second = self.request("POST", "/api/seed/load")
        self.assertEqual(status, 200)
        self.db.expire_all()
        self.assertEqual(
            second["sample_content_id"], first["sample_content_id"]
        )
        self.assertEqual(second["counts"]["removed_content"], 0)
        self.assertEqual(record_counts(), first_counts)

        self.assertIsNone(self.db.get(Content, 1))
        self.assertEqual(self.db.query(Content).count(), 1)
        self.assertEqual(
            self.db.query(AuditEvent)
            .filter(AuditEvent.action == "content_deleted")
            .count(),
            1,
        )
        self.assertIsNotNone(
            self.db.query(Guideline)
            .filter(Guideline.title == "User-owned guideline")
            .first()
        )
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

    def test_guideline_metrics_use_review_history_and_explicit_dismissal_denominator(self):
        cited = Guideline(
            title="Claims policy",
            description="Claims need evidence.",
            category="claims",
        )
        stale = Guideline(
            title="Old tone rule",
            description="Use clear language.",
            category="tone",
        )
        never_cited = Guideline(
            title="Unused rule",
            description="A rule with no usage.",
            category="other",
        )
        self.db.add_all([cited, stale, never_cited])
        self.db.flush()
        now = datetime.now(timezone.utc)
        recent = now - timedelta(days=5)
        old = now - timedelta(days=120)
        self.db.add_all(
            [
                FindingReviewEvent(
                    event_key="review:1:finding:1",
                    finding_reference_id=1,
                    content_version=1,
                    guideline_id=cited.id,
                    guideline_title=cited.title,
                    check_type="unsupported_claim",
                    severity="warning",
                    occurred_at=recent,
                ),
                FindingReviewEvent(
                    event_key="review:1:finding:2",
                    finding_reference_id=2,
                    content_version=1,
                    guideline_id=cited.id,
                    guideline_title=cited.title,
                    check_type="unsupported_claim",
                    severity="high",
                    occurred_at=recent,
                ),
                FindingReviewEvent(
                    event_key="review:2:finding:3",
                    finding_reference_id=3,
                    content_version=1,
                    guideline_id=stale.id,
                    guideline_title=stale.title,
                    check_type="tone",
                    severity="warning",
                    occurred_at=old,
                ),
            ]
        )
        decisions = ("dismissed", "dismissed", "accepted", "resolved")
        self.db.add_all(
            [
                FindingDecisionEvent(
                    event_key=f"finding:{index}:{decision}",
                    finding_reference_id=index,
                    guideline_id=cited.id,
                    guideline_title=cited.title,
                    decision=decision,
                    actor="reviewer",
                    occurred_at=recent,
                )
                for index, decision in enumerate(decisions, start=1)
            ]
        )
        self.db.commit()

        status, response = self.request(
            "GET",
            "/api/guidelines/metrics?period_days=30&stale_after_days=90",
        )

        self.assertEqual(status, 200)
        self.assertEqual(response["period"]["days"], 30)
        self.assertEqual(response["stale_after_days"], 90)
        self.assertEqual(response["totals"]["violation_count"], 2)
        self.assertEqual(response["totals"]["decision_count"], 4)
        self.assertEqual(response["totals"]["dismissed_count"], 2)
        self.assertEqual(response["totals"]["dismissal_rate"], 0.5)

        by_id = {item["guideline_id"]: item for item in response["guidelines"]}
        cited_metrics = by_id[cited.id]
        self.assertEqual(cited_metrics["violation_count"], 2)
        self.assertEqual(cited_metrics["citation_count"], 2)
        self.assertEqual(
            cited_metrics["violations_by_check"],
            {"unsupported_claim": 2},
        )
        self.assertEqual(cited_metrics["dismissal_rate"], 0.5)
        self.assertEqual(cited_metrics["last_reviewed_at"], recent.isoformat())
        self.assertIn("high_dismissal_rate", cited_metrics["attention_reasons"])

        stale_metrics = by_id[stale.id]
        self.assertEqual(stale_metrics["citation_count"], 0)
        self.assertEqual(stale_metrics["last_reviewed_at"], old.isoformat())
        self.assertIn("no_citations_in_period", stale_metrics["attention_reasons"])
        self.assertIn("not_reviewed_recently", stale_metrics["attention_reasons"])
        self.assertIsNone(by_id[never_cited.id]["last_reviewed_at"])
        self.assertEqual(
            set(response["guidelines_without_citations"]),
            {stale.id, never_cited.id},
        )

        suggested = {
            item["guideline_id"]: item
            for item in response["suggested_areas_for_clarification"]
        }
        self.assertIn(cited.id, suggested)
        self.assertIn(stale.id, suggested)
        self.assertIn("high_dismissal_rate", suggested[cited.id]["reasons"])

    def test_guideline_metrics_validate_period_parameters(self):
        status, response = self.request(
            "GET",
            "/api/guidelines/metrics?period_days=0",
        )
        self.assertEqual(status, 422)
        self.assertEqual(response["error"], "validation_error")


if __name__ == "__main__":
    unittest.main()
