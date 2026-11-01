import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Content, ContentImage
from app.services.accessibility_checker import check_accessibility


class AccessibilityCheckerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as db:
            self.content = Content(
                title="Landing page",
                body="Visit our site for a wide audience.",
                created_by="Asha (Creator)",
            )
            db.add(self.content)
            db.flush()
            self.blank_image = ContentImage(
                content_id=self.content.id,
                filename="banner.png",
                mime_type="image/png",
                storage_path="tests-fixture/banner.png",
                alt_text="",
            )
            self.filled_image = ContentImage(
                content_id=self.content.id,
                filename="team.jpg",
                mime_type="image/jpeg",
                storage_path="tests-fixture/team.jpg",
                alt_text="The six-person marketing team at a conference.",
            )
            db.add(self.blank_image)
            db.add(self.filled_image)
            db.commit()
            self.content_id = self.content.id
            self.blank_image_id = self.blank_image.id

    def tearDown(self):
        self.engine.dispose()

    def findings(self):
        with Session(self.engine) as db:
            return check_accessibility(db, db.get(Content, self.content_id))

    def test_blank_alt_text_flagged(self):
        with Session(self.engine) as db:
            db.delete(self.filled_image)
            db.commit()
        findings = self.findings()
        self.assertEqual(len(findings), 1)
        finding = findings[0]
        self.assertEqual(finding["check"], "accessibility")
        self.assertEqual(finding["severity"], "warning")
        self.assertEqual(
            finding["message"], "Image 'banner.png' is missing alt text."
        )
        self.assertEqual(finding["matched_text"], "banner.png")
        self.assertIsNone(finding["start_offset"])
        self.assertIsNone(finding["end_offset"])
        self.assertEqual(
            finding["suggested_fix"],
            "Add descriptive alt text for 'banner.png' so screen readers can "
            "describe it.",
        )
        self.assertEqual(
            finding["source"],
            {"type": "image", "id": self.blank_image_id, "text": "banner.png"},
        )
        self.assertEqual(finding["evidence"], {})

    def test_blank_and_whitespace_alt_text_flagged(self):
        with Session(self.engine) as db:
            self.blank_image.alt_text = "   "
            db.add(
                ContentImage(
                    content_id=self.content.id,
                    filename="logo.png",
                    mime_type="image/png",
                    storage_path="tests-fixture/logo.png",
                    alt_text="",
                )
            )
            db.commit()
        findings = self.findings()
        names = [f["matched_text"] for f in findings]
        self.assertEqual(sorted(names), ["banner.png", "logo.png"])

    def test_filled_alt_text_not_flagged(self):
        with Session(self.engine) as db:
            db.delete(self.blank_image)
            db.commit()
        self.assertEqual(self.findings(), [])

    def test_no_images_no_findings(self):
        with Session(self.engine) as db:
            db.delete(self.blank_image)
            db.delete(self.filled_image)
            db.commit()
        self.assertEqual(self.findings(), [])


if __name__ == "__main__":
    unittest.main()
