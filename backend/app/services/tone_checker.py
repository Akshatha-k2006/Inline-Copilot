import re

from sqlalchemy.orm import Session

from app.models import Guideline


_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3}


def check_tone(text: str, db: Session) -> list[dict]:
    guidelines = (
        db.query(Guideline)
        .filter(
            (Guideline.category.ilike("tone"))
            | (Guideline.title.ilike("%tone%"))
        )
        .all()
    )
    findings = []

    for guideline in guidelines:
        limit_match = re.search(
            r"\bno more than\s+(one|two|three|\d+)\s+exclamation marks?\b",
            guideline.description,
            re.IGNORECASE,
        )
        if not limit_match:
            continue

        limit_token = limit_match.group(1).lower()
        limit = _NUMBER_WORDS.get(limit_token)
        if limit is None:
            limit = int(limit_token)

        exclamations = list(re.finditer("!", text))
        if len(exclamations) <= limit:
            continue

        match = exclamations[limit]
        findings.append(
            {
                "check": "tone",
                "severity": "warning",
                "message": (
                    "This content exceeds the exclamation-mark limit in "
                    f"guideline {guideline.id}."
                ),
                "matched_text": match.group(0),
                "start_offset": match.start(),
                "end_offset": match.end(),
                "suggested_fix": None,
                "source": {
                    "type": "guideline",
                    "id": guideline.id,
                    "text": guideline.description,
                },
            }
        )

    return findings
