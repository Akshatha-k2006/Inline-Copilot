import logging
import json
import re
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Guideline

RELEVANT_GUIDELINE_TERMS = {"tone", "messaging", "brand", "claim", "claims"}
VALID_CHECKS = {"tone", "messaging", "unsupported_claim"}
VALID_SEVERITIES = {"high", "medium", "low", "warning"}
logger = logging.getLogger(__name__)


class LLMTimeoutError(Exception):
    pass


class LLMReviewError(Exception):
    pass


class LLMProviderError(LLMReviewError):
    def __init__(self, status_code: int):
        super().__init__()
        self.status_code = status_code


class LLMTransportError(LLMReviewError):
    pass


class LLMResponseError(LLMReviewError):
    pass


def _applicable_guidelines(db: Session) -> list[Guideline]:
    guidelines = db.query(Guideline).order_by(Guideline.id).all()
    return [
        guideline
        for guideline in guidelines
        if _guideline_topics(guideline) & RELEVANT_GUIDELINE_TERMS
    ]


def _guideline_topics(guideline: Guideline) -> set[str]:
    return set(
        re.findall(r"[a-z]+", f"{guideline.category} {guideline.title}".lower())
    )


def _request_review(text: str, guidelines: list[Guideline]) -> object:
    serialized_guidelines = [
        {
            "id": guideline.id,
            "category": guideline.category,
            "title": guideline.title,
            "description": guideline.description,
        }
        for guideline in guidelines
    ]
    request_body = {
        "model": settings.llm_model,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": (
                    "Review the supplied content only against the supplied "
                    "brand guidelines. Return a JSON object with a findings "
                    "array. Each finding must have check (tone, messaging, "
                    "or unsupported_claim), guideline_id, matched_text, "
                    "explanation, and severity (high, medium, or low). "
                    "Optionally include start_offset, end_offset, and "
                    "suggested_fix. matched_text must be an exact substring "
                    "of the content. Use only supplied guideline IDs. Do not "
                    "report terminology findings; deterministic checks handle "
                    "those."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {"content": text, "guidelines": serialized_guidelines}
                ),
            },
        ],
    }
    request = Request(
        settings.llm_api_url,
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=settings.llm_timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (TimeoutError, socket.timeout) as exc:
        raise LLMTimeoutError from exc
    except HTTPError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise LLMTimeoutError from exc
        logger.warning(
            "Hosted LLM request failed: category=provider status=%d",
            exc.code,
        )
        raise LLMProviderError(exc.code) from exc
    except URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise LLMTimeoutError from exc
        raise LLMTransportError from exc
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LLMResponseError from exc
    except OSError as exc:
        raise LLMTransportError from exc

    try:
        return payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMResponseError from exc


def _validated_findings(
    response: object,
    text: str,
    guidelines: list[Guideline],
) -> list[dict]:
    try:
        parsed = json.loads(response) if isinstance(response, str) else response
    except json.JSONDecodeError as exc:
        raise LLMResponseError from exc

    if not isinstance(parsed, dict) or not isinstance(parsed.get("findings"), list):
        raise LLMResponseError("Invalid findings response")

    guideline_by_id = {guideline.id: guideline for guideline in guidelines}
    validated = []

    for item in parsed["findings"]:
        if not isinstance(item, dict):
            raise LLMResponseError("Invalid finding")

        check = item.get("check")
        guideline_id = item.get("guideline_id")
        matched_text = item.get("matched_text")
        explanation = item.get("explanation")
        severity = item.get("severity", "medium")
        suggested_fix = item.get("suggested_fix")

        if (
            check not in VALID_CHECKS
            or not isinstance(guideline_id, int)
            or isinstance(guideline_id, bool)
            or guideline_id not in guideline_by_id
            or not isinstance(matched_text, str)
            or not matched_text.strip()
            or not isinstance(explanation, str)
            or not explanation.strip()
            or severity not in VALID_SEVERITIES
            or (
                suggested_fix is not None
                and not isinstance(suggested_fix, str)
            )
        ):
            raise LLMResponseError("Invalid finding fields")

        guideline = guideline_by_id[guideline_id]
        topics = _guideline_topics(guideline)
        if check == "tone" and not topics & {"tone", "brand"}:
            raise LLMResponseError("Finding has an unrelated source guideline")
        if check == "messaging" and not topics & {"messaging", "brand"}:
            raise LLMResponseError("Finding has an unrelated source guideline")
        if check == "unsupported_claim" and not topics & {
            "claim",
            "claims",
            "brand",
        }:
            raise LLMResponseError("Finding has an unrelated source guideline")

        start = item.get("start_offset")
        end = item.get("end_offset")
        valid_offsets = (
            isinstance(start, int)
            and not isinstance(start, bool)
            and isinstance(end, int)
            and not isinstance(end, bool)
            and 0 <= start < end <= len(text)
            and text[start:end] == matched_text
        )
        if not valid_offsets:
            start = text.find(matched_text)
            if start < 0:
                raise LLMResponseError("Finding text is not present in content")
            end = start + len(matched_text)

        validated.append(
            {
                "check": check,
                "severity": "warning" if severity == "warning" else severity,
                "message": explanation.strip(),
                "matched_text": matched_text,
                "start_offset": start,
                "end_offset": end,
                "suggested_fix": suggested_fix,
                "source": {
                    "type": "guideline",
                    "id": guideline.id,
                    "title": guideline.title,
                    "category": guideline.category,
                },
            }
        )

    return validated


def review_with_llm(text: str, db: Session) -> list[dict]:
    """Review content against the applicable persisted brand guidelines."""
    if not settings.llm_api_key:
        return []

    guidelines = _applicable_guidelines(db)
    if not guidelines:
        return []

    response = _request_review(text, guidelines)
    return _validated_findings(response, text, guidelines)
