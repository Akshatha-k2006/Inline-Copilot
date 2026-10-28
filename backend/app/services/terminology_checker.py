import re

from sqlalchemy.orm import Session

from app.models import Term

def check_terminology(text: str, db: Session) -> list[dict]:
    """
    Detect prohibited glossary terms using case-insensitive,
    whole-word matching.

    Returns each finding with offsets, preferred replacement,
    and its source glossary entry.
    """
    findings = []

    prohibited_terms = (
        db.query(Term)
        .filter(Term.status.ilike("prohibited"))
        .all()
    )

    for term in prohibited_terms:
        if not term.term:
            continue

        pattern = re.compile(
            rf"(?<!\w){re.escape(term.term)}(?!\w)",
            re.IGNORECASE,
        )

        for match in pattern.finditer(text):
            findings.append(
                {
                    "check": "terminology",
                    "severity": "warning",
                    "message": f"Prohibited term detected: {match.group(0)}",
                    "matched_text": match.group(0),
                    "start_offset": match.start(),
                    "end_offset": match.end(),
                    "suggested_fix": term.replacement or None,
                    "source": {
                        "type": "glossary",
                        "id": term.id,
                        "term": term.term,
                        "status": term.status,
                        "preferred_term": term.replacement,
                        "explanation": term.explanation,
                        "guideline_id": term.guideline_id,
                    },
                }
            )

    return sorted(findings, key=lambda finding: finding["start_offset"])
