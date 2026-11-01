import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import Asset, Content, ContentImage, Finding
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

    def test_recheck_resolves_same_alt_text_finding(self):
        first = self.review()
        finding = self.accessibility_findings(first.json())[0]
        with Session(self.engine) as db:
            image = db.get(ContentImage, self.image_id)
            image.alt_text = "Wide banner for the landing page."
            db.commit()
        response = self.client.post(
            f"/api/content/{self.content_id}/findings/{finding['id']}/recheck",
            headers={"X-Role": "creator", "X-User": "Asha (Creator)"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "resolved")
        self.assertEqual(response.json()["finding"]["id"], finding["id"])
        with Session(self.engine) as db:
            persisted = db.get(Finding, finding["id"])
            self.assertEqual(persisted.status, "resolved")

    def test_review_includes_contrast_finding_when_colors_are_configured(self):
        with Session(self.engine) as db:
            content = db.get(Content, self.content_id)
            content.foreground_color = "#777777"
            content.background_color = "#FFFFFF"
            content.text_size = "normal"
            db.add(
                Asset(
                    name="Palette",
                    description="Slate #777777 and white #FFFFFF",
                    asset_type="palette",
                )
            )
            db.commit()
        response = self.review()
        self.assertEqual(response.status_code, 200)
        contrast = [
            item
            for item in self.accessibility_findings(response.json())
            if item["evidence"]["source"]["type"] == "contrast"
        ]
        self.assertEqual(len(contrast), 1)
        self.assertIn("4.5:1", contrast[0]["message"])
        self.assertEqual(contrast[0]["evidence"]["contrast"]["required_ratio"], 4.5)

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


class AccessibilityFindingActionTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        llm_patch = patch(
            "app.services.llm_reviewer.settings.llm_api_key", None
        )
        llm_patch.start()
        self.addCleanup(llm_patch.stop)
        with Session(self.engine) as db:
            content = Content(
                title="Landing page",
                body="Visit our site for a wide audience.",
                created_by="Asha",
            )
            db.add(content)
            db.flush()
            self.content_id = content.id
            finding = Finding(
                content_id=content.id,
                content_version=1,
                check_type="accessibility",
                severity="warning",
                message="Image 'banner.png' is missing alt text.",
                evidence={
                    "matched_text": "banner.png",
                    "source": {"type": "image", "id": 1, "text": "banner.png"},
                    "requires_manual_review": False,
                },
                suggested_fix=(
                    "Add descriptive alt text for 'banner.png' so screen "
                    "readers can describe it."
                ),
                start_offset=None,
                end_offset=None,
                status="open",
            )
            db.add(finding)
            db.commit()
            self.finding_id = finding.id

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

    def act(self, action_body):
        return self.client.patch(
            f"/api/findings/{self.finding_id}",
            headers={"X-Role": "creator", "X-User": "Asha (Creator)"},
            json=action_body,
        )

    def test_dismiss_spanless_accessibility_finding(self):
        response = self.act({"action": "dismiss"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["finding"]["status"], "dismissed")
        with Session(self.engine) as db:
            finding = db.get(Finding, self.finding_id)
            self.assertEqual(finding.status, "dismissed")
            self.assertIsNone(finding.start_offset)

    def test_accept_and_edit_spanless_return_finding_not_textual(self):
        for action_body in (
            {"action": "accept"},
            {"action": "edit", "replacement": "added description"},
        ):
            with self.subTest(action=action_body["action"]):
                response = self.act(action_body)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(
                    response.json()["error"], "finding_not_textual"
                )
        with Session(self.engine) as db:
            finding = db.get(Finding, self.finding_id)
            self.assertEqual(finding.status, "open")


if __name__ == "__main__":
    unittest.main()
