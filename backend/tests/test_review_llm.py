import json
import io
import os
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import BACKEND_ENV_FILE, Settings
from app.db import Base
from app.models import Content, Fact, Guideline, Term
from app.routers.review import review_content
from app.services import llm_reviewer


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return self.payload


class ReviewLLMTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.db.add_all(
            [
                Guideline(
                    id=1,
                    title="Tone of voice",
                    description="Warm, clear and confident.",
                    category="tone",
                ),
                Guideline(
                    id=2,
                    title="Messaging pillars",
                    description="Lead with the customer benefit.",
                    category="messaging",
                ),
                Guideline(
                    id=3,
                    title="Claims policy",
                    description="Claims require approved evidence.",
                    category="claims",
                ),
                Guideline(
                    id=4,
                    title="Legal notice",
                    description="Include standard legal notices.",
                    category="legal",
                ),
                Guideline(
                    id=5,
                    title="Disclaimers",
                    description="Include product disclaimers.",
                    category="legal",
                ),
                Term(
                    id=1,
                    term="badword",
                    replacement="better word",
                    status="prohibited",
                    explanation="Not on brand.",
                ),
                Fact(id=1, statement="Approved fact", source="Test source"),
                Content(
                    id=1,
                    title="Test content",
                    body="This is too loud and says badword is best.",
                    created_by="test",
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_settings_load_backend_env_independent_of_process_cwd(self):
        expected_env_file = Path(__file__).resolve().parents[1] / ".env"
        self.assertEqual(BACKEND_ENV_FILE, expected_env_file)
        self.assertEqual(Settings.model_config["env_file"], expected_env_file)

    def test_settings_read_llm_api_key_from_environment(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "sqlite://", "LLM_API_KEY": "test-key"},
            clear=True,
        ):
            settings = Settings(_env_file=None)

        self.assertEqual(settings.llm_api_key, "test-key")

    def test_settings_leave_llm_api_key_unset_when_not_configured(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "sqlite://"},
            clear=True,
        ):
            settings = Settings(_env_file=None)

        self.assertIsNone(settings.llm_api_key)

    def test_settings_default_to_gemini_compatible_endpoint_and_model(self):
        with patch.dict(
            os.environ,
            {"DATABASE_URL": "sqlite://"},
            clear=True,
        ):
            settings = Settings(_env_file=None)

        self.assertEqual(
            settings.llm_api_url,
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(settings.llm_model, "gemini-2.5-flash")

    def test_provider_errors_are_classified_without_logging_provider_messages(self):
        cases = (
            (401, {"status": "UNAUTHENTICATED"}, "authentication_rejected"),
            (400, {"message": "API key not valid"}, "authentication_rejected"),
            (403, {"status": "PERMISSION_DENIED"}, "project_access_denied"),
            (429, {"status": "RESOURCE_EXHAUSTED"}, "quota_or_rate_limit"),
            (
                400,
                {"status": "INVALID_ARGUMENT", "message": "Unsupported response_format"},
                "unsupported_response_format",
            ),
            (
                404,
                {"status": "NOT_FOUND", "message": "model was not found"},
                "model_or_resource_not_found",
            ),
        )
        for status_code, error, expected in cases:
            with self.subTest(status_code=status_code):
                body = json.dumps([{"error": error}]).encode("utf-8")
                self.assertEqual(
                    llm_reviewer._provider_error_category(status_code, body),
                    expected,
                )

    def test_successful_llm_review_sends_only_relevant_guidelines_and_timeout(self):
        llm_content = json.dumps(
            {
                "findings": [
                    {
                        "check": "tone",
                        "guideline_id": 1,
                        "matched_text": "too loud",
                        "explanation": "This wording is not warm.",
                        "severity": "medium",
                        "start_offset": 8,
                        "end_offset": 16,
                    }
                ]
            }
        )
        response = FakeResponse(
            {
                "choices": [
                    {"message": {"content": llm_content}},
                ]
            }
        )
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(llm_reviewer.settings, "llm_timeout_seconds", 7),
            patch.object(llm_reviewer, "urlopen", return_value=response) as opener,
        ):
            result = review_content(1, self.db)

        request = opener.call_args.args[0]
        sent = json.loads(request.data.decode("utf-8"))
        user_payload = json.loads(sent["messages"][1]["content"])
        self.assertEqual(
            request.full_url,
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        )
        self.assertEqual(request.get_header("Authorization"), "Bearer test-key")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(sent["model"], "gemini-2.5-flash")
        self.assertNotIn("response_format", sent)
        self.assertEqual(opener.call_args.kwargs["timeout"], 7)
        self.assertEqual(
            [guideline["id"] for guideline in user_payload["guidelines"]],
            [1, 2, 3],
        )
        self.assertEqual(user_payload["content"], "This is too loud and says badword is best.")
        self.assertEqual(result["engine"]["llm"], "ok")
        finding = next(item for item in result["findings"] if item["check"] == "tone")
        self.assertEqual(finding["evidence"]["matched_text"], "too loud")
        self.assertEqual(finding["start_offset"], 8)
        self.assertEqual(finding["end_offset"], 16)
        self.assertEqual(finding["evidence"]["source"]["id"], 1)

    def test_missing_key_disables_llm_and_keeps_rule_findings(self):
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", None),
            patch.object(llm_reviewer, "urlopen") as opener,
        ):
            result = review_content(1, self.db)

        self.assertEqual(result["engine"]["llm"], "disabled")
        self.assertEqual(result["engine"]["rules"], "ok")
        self.assertFalse(opener.called)
        checks = [finding["check"] for finding in result["findings"]]
        self.assertIn("terminology", checks)
        self.assertIn("unsupported_claim", checks)
        self.assertTrue(
            all(finding["evidence"]["source"]["id"] for finding in result["findings"])
        )

    def test_timeout_falls_back_to_rule_findings(self):
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(llm_reviewer, "urlopen", side_effect=TimeoutError),
        ):
            result = review_content(1, self.db)

        self.assertEqual(result["engine"]["llm"], "timeout")
        self.assertIn("terminology", [item["check"] for item in result["findings"]])
        self.assertIn(
            "unsupported_claim",
            [item["check"] for item in result["findings"]],
        )

    def test_transport_failure_is_logged_without_details_and_falls_back(self):
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(
                llm_reviewer,
                "urlopen",
                side_effect=URLError("sensitive transport detail"),
            ),
            self.assertLogs("app.routers.review", level="WARNING") as captured,
        ):
            result = review_content(1, self.db)

        self.assertEqual(result["engine"]["llm"], "error")
        self.assertTrue(any("category=transport" in line for line in captured.output))
        self.assertNotIn("sensitive transport detail", "\n".join(captured.output))
        self.assertIn("terminology", [item["check"] for item in result["findings"]])

    def test_provider_failure_falls_back_without_exposing_error(self):
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(llm_reviewer, "urlopen", side_effect=RuntimeError("secret")),
        ):
            result = review_content(1, self.db)

        self.assertEqual(result["engine"]["llm"], "error")
        self.assertNotIn("secret", json.dumps(result))
        self.assertIn("terminology", [item["check"] for item in result["findings"]])

    def test_http_provider_error_logs_category_and_status_only(self):
        provider_body = json.dumps(
            [
                {
                    "error": {
                        "status": "RESOURCE_EXHAUSTED",
                        "message": "rate limit: confidential provider response",
                    }
                }
            ]
        ).encode("utf-8")
        provider_error = HTTPError(
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            429,
            "rate limit: confidential provider response",
            {},
            io.BytesIO(provider_body),
        )
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(llm_reviewer, "urlopen", side_effect=provider_error),
            self.assertLogs(
                "app.routers.review",
                level="WARNING",
            ) as captured,
        ):
            result = review_content(1, self.db)

        self.assertEqual(result["engine"]["llm"], "error")
        self.assertTrue(
            any(
                "category=provider status=429 reason=quota_or_rate_limit" in line
                for line in captured.output
            )
        )
        self.assertNotIn("confidential", json.dumps(result))
        self.assertNotIn("confidential", "\n".join(captured.output))
        self.assertNotIn("test-key", "\n".join(captured.output))
        self.assertNotIn("This is too loud", "\n".join(captured.output))
        self.assertIn("terminology", [item["check"] for item in result["findings"]])

    def test_unexpected_response_structure_is_logged_and_falls_back(self):
        response = FakeResponse({"choices": []})
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(llm_reviewer, "urlopen", return_value=response),
            self.assertLogs("app.routers.review", level="WARNING") as captured,
        ):
            result = review_content(1, self.db)

        self.assertEqual(result["engine"]["llm"], "error")
        self.assertTrue(
            any(
                "category=unexpected_response_structure" in line
                for line in captured.output
            )
        )
        self.assertIn("terminology", [item["check"] for item in result["findings"]])

    def test_malformed_response_falls_back_and_invalid_source_is_rejected(self):
        malformed_response = FakeResponse(
            {"choices": [{"message": {"content": "not-json"}}]}
        )
        with (
            patch.object(llm_reviewer.settings, "llm_api_key", "test-key"),
            patch.object(llm_reviewer, "urlopen", return_value=malformed_response),
            self.assertLogs("app.routers.review", level="WARNING") as captured,
        ):
            result = review_content(1, self.db)
        self.assertEqual(result["engine"]["llm"], "error")
        self.assertTrue(
            any("category=invalid_json" in line for line in captured.output)
        )

        with self.assertRaises(llm_reviewer.LLMResponseError) as raised:
            llm_reviewer._validated_findings(
                {
                    "findings": [
                        {
                            "check": "tone",
                            "guideline_id": 4,
                            "matched_text": "too loud",
                            "explanation": "Bad tone.",
                            "severity": "low",
                        }
                    ]
                },
                "This is too loud.",
                [self.db.get(Guideline, 4)],
            )
        self.assertEqual(raised.exception.category, "finding_validation")

    def test_overlapping_rule_and_llm_claims_are_not_duplicated(self):
        finding = {
            "check": "unsupported_claim",
            "severity": "medium",
            "message": "This claim is unsupported.",
            "matched_text": "is best",
            "start_offset": 34,
            "end_offset": 41,
            "suggested_fix": None,
            "source": {"type": "guideline", "id": 3},
        }
        with patch("app.routers.review.review_with_llm", return_value=[finding]):
            result = review_content(1, self.db)

        claim_findings = [
            item for item in result["findings"] if item["check"] == "unsupported_claim"
        ]
        self.assertEqual(len(claim_findings), 1)

    def test_repeated_review_replaces_prior_tone_and_messaging_findings(self):
        finding = {
            "check": "tone",
            "severity": "medium",
            "message": "This wording is not warm.",
            "matched_text": "too loud",
            "start_offset": 8,
            "end_offset": 16,
            "suggested_fix": None,
            "source": {"type": "guideline", "id": 1},
        }
        with patch("app.routers.review.review_with_llm", return_value=[finding]):
            review_content(1, self.db)
        with patch("app.routers.review.review_with_llm", return_value=[]):
            result = review_content(1, self.db)

        tone_findings = [item for item in result["findings"] if item["check"] == "tone"]
        self.assertEqual(tone_findings, [])

    def test_duplicate_llm_findings_are_saved_once(self):
        finding = {
            "check": "tone",
            "severity": "medium",
            "message": "This wording is not warm.",
            "matched_text": "too loud",
            "start_offset": 8,
            "end_offset": 16,
            "suggested_fix": None,
            "source": {"type": "guideline", "id": 1},
        }
        with patch(
            "app.routers.review.review_with_llm",
            return_value=[finding, finding.copy()],
        ):
            result = review_content(1, self.db)

        tone_findings = [item for item in result["findings"] if item["check"] == "tone"]
        self.assertEqual(len(tone_findings), 1)


if __name__ == "__main__":
    unittest.main()
