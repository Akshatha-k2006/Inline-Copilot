import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import Content, ContentImage, Finding
from app.routers import content as content_router
from app.routers import review


class ReviewAccessibilityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        patch_msg = patch(
            "app.services.llm_reviewer.settings.llm_api_key", None
        )
        patch_msg.start()
        self.addCleanup(patch_msg.stop)
        with Session(self.engine) as db:
            content = Content(
                title="Landing page",
                body="Visit our site for a wide audience.",
                created_by="Asha",
            )
            db.add(content)
            db.flush()
            self.content_id = content.id
            image = ContentImage(
                content_id=content.id,
                filename="banner.png",
                mime_type="image/png",
                storage_path="tests-fixture/banner.png",
                alt_text="",
            )
            db.add(image)
            db.commit()
            self.image_id = image.id

        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(review.router, prefix="/api")
        app.include_router(content_router.router, prefix="/api")

        def override_get_db():
            with Session(self.engine) as db:
                yield db

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        self.engine.dispose()

    def review(self, content_id=None):
        return self.client.post(
            f"/api/content/{content_id or self.content_id}/review",
            headers={"X-Role": "creator", "X-User": "Asha (Creator)"},
        )

    def accessibility_findings(self, payload):
        return [f for f in payload["findings"] if f["check"] == "accessibility"]

    def test_review_flags_blank_alt_text(self):
        response = self.review()
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        flagged = self.accessibility_findings(payload)
        self.assertEqual(len(flagged), 1)
        finding = flagged[0]
        self.assertEqual(finding["severity"], "warning")
        self.assertEqual(finding["message"], "Image 'banner.png' is missing alt text.")
        self.assertTrue(finding["suggested_fix"])
        self.assertIsNone(finding["start_offset"])
        self.assertIsNone(finding["end_offset"])
        self.assertEqual(finding["evidence"]["source"]["type"], "image")
        self.assertEqual(finding["status"], "open")
        with Session(self.engine) as db:
            persisted = (
                db.query(Finding)
                .filter(Finding.check_type == "accessibility")
                .all()
            )
            self.assertEqual(len(persisted), 1)
            self.assertEqual(persisted[0].content_id, self.content_id)

    def test_two_blank_images_two_findings(self):
        with Session(self.engine) as db:
            db.add(
                ContentImage(
                    content_id=self.content_id,
                    filename="logo.png",
                    mime_type="image/png",
                    storage_path="tests-fixture/logo.png",
                    alt_text="   ",
                )
            )
            db.commit()
        response = self.review()
        self.assertEqual(response.status_code, 200)
        flagged = self.accessibility_findings(response.json())
        self.assertEqual(len(flagged), 2)
        names = sorted(f["message"] for f in flagged)
        self.assertEqual(
            names,
            ["Image 'banner.png' is missing alt text.", "Image 'logo.png' is missing alt text."],
        )

    def test_filled_alt_text_no_finding_on_rereview(self):
        first = self.review()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(self.accessibility_findings(first.json())), 1)
        with Session(self.engine) as db:
            image = db.get(ContentImage, self.image_id)
            image.alt_text = "Wide banner for the landing page."
            db.commit()
        second = self.review()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(self.accessibility_findings(second.json()), [])

    def test_persisted_finding_has_fix_and_low_manual_review(self):
        response = self.review()
        self.assertEqual(response.status_code, 200)
        with Session(self.engine) as db:
            finding = (
                db.query(Finding)
                .filter(Finding.check_type == "accessibility")
                .one()
            )
        self.assertEqual(finding.severity, "warning")
        self.assertTrue(finding.suggested_fix)
        self.assertIs(finding.evidence["requires_manual_review"], False)

    def test_upload_rejects_unsupported_format(self):
        response = self.client.post(
            f"/api/content/{self.content_id}/images",
            headers={"X-Role": "creator", "X-User": "Asha (Creator)"},
            files={"file": ("diagram.gif", b"GIF89a\x01\x00", "image/gif")},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")


if __name__ == "__main__":
    unittest.main()
