import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.exception_handlers import register_exception_handlers
from app.models import Asset
from app.routers.accessibility import router
from app.services.accessibility_checker import (
    contrast_ratio,
    relative_luminance,
)


class ContrastCalculationTests(unittest.TestCase):
    def test_wcag_relative_luminance_and_contrast_ratio(self):
        self.assertAlmostEqual(relative_luminance("#000"), 0)
        self.assertAlmostEqual(relative_luminance("#FFF"), 1)
        self.assertAlmostEqual(contrast_ratio("#000000", "#FFFFFF"), 21)
        self.assertAlmostEqual(contrast_ratio("#767676", "#FFFFFF"), 4.54, places=2)
        self.assertAlmostEqual(contrast_ratio("#777777", "#FFFFFF"), 4.48, places=2)


class ContrastEndpointTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add(
            Asset(
                name="Brand palette",
                description=(
                    "Warm amber #F2A93B, deep slate #26323B, "
                    "soft white #FAF8F3."
                ),
                asset_type="palette",
            )
        )
        self.db.commit()

        app = FastAPI()
        register_exception_handlers(app)
        app.include_router(router, prefix="/api")

        def override_get_db():
            yield self.db

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app, raise_server_exceptions=False)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def check(self, foreground, background, text_size="normal"):
        return self.client.post(
            "/api/accessibility/contrast",
            headers={"X-Role": "creator"},
            json={
                "foreground_color": foreground,
                "background_color": background,
                "text_size": text_size,
            },
        )

    def test_failing_pair_returns_palette_replacement_and_finding(self):
        response = self.check("#F2A93B", "#FAF8F3")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertFalse(result["passes"])
        self.assertEqual(result["required_ratio"], 4.5)
        self.assertEqual(
            result["brand_palette_match"],
            {"foreground": True, "background": True},
        )
        self.assertEqual(result["finding"]["check"], "accessibility")
        self.assertIn("WCAG AA", result["finding"]["message"])

        replacement = result["suggested_replacement"]
        self.assertIsNotNone(replacement)
        self.assertGreaterEqual(replacement["contrast_ratio"], 4.5)
        palette_colors = {"#F2A93B", "#26323B", "#FAF8F3"}
        self.assertIn(replacement["foreground_color"], palette_colors)
        self.assertIn(replacement["background_color"], palette_colors)
        self.assertIn(
            replacement["foreground_color"],
            result["finding"]["suggested_fix"],
        )

    def test_large_text_uses_lower_aa_threshold(self):
        normal_pass = self.check("#767676", "#FFFFFF")
        normal_text = self.check("#777777", "#FFFFFF")
        large_text = self.check("#777777", "#FFFFFF", "large")
        self.assertTrue(normal_pass.json()["passes"])
        self.assertFalse(normal_text.json()["passes"])
        self.assertTrue(large_text.json()["passes"])
        self.assertEqual(large_text.json()["required_ratio"], 3.0)
        self.assertIsNone(large_text.json()["finding"])

    def test_passing_pair_reports_brand_palette_membership(self):
        response = self.check("#000", "#FFF")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertTrue(result["passes"])
        self.assertEqual(
            result["brand_palette_match"],
            {"foreground": False, "background": False},
        )

    def test_missing_brand_palette_still_checks_input_colors(self):
        self.db.query(Asset).delete()
        self.db.commit()
        response = self.check("#000", "#FFF")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertTrue(result["passes"])
        self.assertEqual(result["contrast_ratio"], 21)
        self.assertEqual(
            result["brand_palette_match"],
            {"foreground": False, "background": False},
        )
        self.assertIsNone(result["finding"])
        self.assertIsNone(result["suggested_replacement"])

    def test_missing_palette_explains_unavailable_replacement(self):
        self.db.query(Asset).delete()
        self.db.commit()
        response = self.check("#F2A93B", "#FAF8F3")
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertFalse(result["passes"])
        self.assertEqual(result["contrast_ratio"], 1.88)
        self.assertIsNone(result["suggested_replacement"])
        self.assertIn(
            "No brand palette colors are configured",
            result["finding"]["suggested_fix"],
        )

    def test_invalid_color_is_rejected(self):
        response = self.check("red", "#FFFFFF")
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"], "validation_error")


if __name__ == "__main__":
    unittest.main()
