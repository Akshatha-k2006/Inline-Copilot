import unittest
from unittest.mock import patch
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db import Base
from app.models import Asset, Content, Fact, Guideline, Term
from app.routers.review import review_content
from app.routers.seed import load_seed_data
from app.services.fact_checker import check_claims
from app.services.terminology_checker import check_terminology
from app.services.tone_checker import check_tone


class SampleCheckerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_seeded_sample_reports_all_eight_required_problems_with_sources(self):
        seed_result = load_seed_data("admin", self.db)
        content = self.db.get(Content, seed_result["sample_content_id"])
        self.assertIsNotNone(content)
        seeded_term = (
            self.db.query(Term)
            .filter(Term.term == "LuminaBulbs")
            .one()
        )
        self.assertIsNotNone(seeded_term.guideline_id)
        self.assertIsNotNone(self.db.get(Guideline, seeded_term.guideline_id))

        with patch("app.routers.review.review_with_llm", return_value=[]):
            result = review_content(
                content.id, "Asha (Creator)", "creator", self.db
            )
        findings_by_text = {
            finding["evidence"]["matched_text"]: finding
            for finding in result["findings"]
        }
        expected = {
            "LuminaBulbs",
            "#1 best smart bulbs on the planet",
            "cut your energy bill by 90%",
            "guaranteed to last forever",
            "revolutionary",
            "cheap",
            "lol",
            "Over 2 million happy customers",
        }

        self.assertTrue(expected.issubset(findings_by_text))
        self.assertEqual(findings_by_text["LuminaBulbs"]["check"], "terminology")
        self.assertEqual(
            findings_by_text["#1 best smart bulbs on the planet"]["check"],
            "unsupported_claim",
        )
        self.assertEqual(
            findings_by_text["cut your energy bill by 90%"]["check"],
            "unsupported_claim",
        )
        self.assertEqual(
            findings_by_text["Over 2 million happy customers"]["check"],
            "outdated_info",
        )
        energy_source = findings_by_text["cut your energy bill by 90%"][
            "evidence"
        ]["source"]
        self.assertEqual(energy_source["citation"], "Lab report LT-2025-03 (sample)")
        guarantee_source = findings_by_text["guaranteed to last forever"][
            "evidence"
        ]["source"]
        self.assertTrue(guarantee_source["related_facts"])

        for finding in findings_by_text.values():
            source = finding["evidence"]["source"]
            if source["type"] == "guideline":
                self.assertIsNotNone(self.db.get(Guideline, source["id"]))
            elif source["type"] == "glossary":
                self.assertIsNotNone(self.db.get(Term, source["id"]))
            elif source["type"] == "fact":
                self.assertIsNotNone(self.db.get(Fact, source["id"]))
            for related_fact in source.get("related_facts", []):
                self.assertIsNotNone(self.db.get(Fact, related_fact["id"]))

        self.assertEqual(self.db.query(Asset).count(), 2)

    def test_subsequent_checks_use_updated_knowledge_records(self):
        load_seed_data("admin", self.db)

        term = self.db.query(Term).filter(Term.term == "cheap").one()
        self.assertEqual(
            check_terminology("cheap", self.db)[0]["suggested_fix"],
            "affordable",
        )
        term.replacement = "good value"
        self.db.commit()
        self.assertEqual(
            check_terminology("cheap", self.db)[0]["suggested_fix"],
            "good value",
        )
        term.status = "approved"
        self.db.commit()
        self.assertEqual(check_terminology("cheap", self.db), [])

        customer_fact = (
            self.db.query(Fact)
            .filter(Fact.statement == "More than 1.2 million customers served.")
            .one()
        )
        customer_fact.statement = "More than 2.5 million customers served."
        customer_fact.review_by = datetime(2099, 12, 31, tzinfo=timezone.utc)
        self.db.commit()
        claim_findings = check_claims(
            "Over 2 million happy customers",
            self.db,
        )
        self.assertEqual(claim_findings, [])

        tone_guideline = (
            self.db.query(Guideline)
            .filter(Guideline.category == "tone")
            .one()
        )
        tone_guideline.description = (
            "Warm, clear and confident. No more than two exclamation marks per piece."
        )
        self.db.commit()
        self.assertEqual(check_tone("Wonderful!!", self.db), [])


if __name__ == "__main__":
    unittest.main()
