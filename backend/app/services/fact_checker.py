
import re
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Fact, Guideline


def _number(value: str) -> float:
    """Convert values such as '1.2 million' into numbers."""
    value = value.lower().replace(",", "").strip()

    match = re.fullmatch(
        r"(\d+(?:\.\d+)?)\s*(thousand|million|billion)?",
        value,
    )

    if not match:
        return 0.0

    multipliers = {
        "thousand": 1_000,
        "million": 1_000_000,
        "billion": 1_000_000_000,
    }

    return float(match.group(1)) * multipliers.get(match.group(2), 1)


def _fact_is_outdated(fact: Fact) -> bool:
    """Return whether a fact's review date has passed."""
    if fact.review_by is None:
        return False

    review_by = fact.review_by

    if review_by.tzinfo is not None:
        review_by = review_by.astimezone(timezone.utc)

    return review_by.date() < datetime.now(timezone.utc).date()


def _numbers(text: str) -> list[float]:
    """Extract numeric values, including thousand/million/billion amounts."""
    pattern = (
        r"\d+(?:,\d{3})*(?:\.\d+)?"
        r"\s*(?:thousand|million|billion)?"
    )

    return [_number(value) for value in re.findall(pattern, text, re.I)]


def check_claims(text: str, db: Session) -> list[dict]:
    """Check claims against approved facts and claims guidelines."""
    findings = []
    facts = db.query(Fact).all()
    guidelines = db.query(Guideline).all()

    claims_guideline = next(
        (
            guideline
            for guideline in guidelines
            if "claim" in f"{guideline.title} {guideline.description}".lower()
        ),
        None,
    )

    def add_finding(
        matched_text: str,
        start: int,
        end: int,
        check: str,
        message: str,
        source_type: str,
        source_id: int | None,
        source_text: str,
    ) -> None:
        findings.append(
            {
                "check": check,
                "severity": "warning",
                "message": message,
                "matched_text": matched_text,
                "start_offset": start,
                "end_offset": end,
                "suggested_fix": None,
                "source": {
                    "type": source_type,
                    "id": source_id,
                    "text": source_text,
                },
            }
        )

    def add_fact_finding(
        match: re.Match,
        fact: Fact,
        message: str,
    ) -> None:
        check = (
            "outdated_info"
            if _fact_is_outdated(fact)
            else "unsupported_claim"
        )

        add_finding(
            match.group(0).strip(),
            match.start(),
            match.end(),
            check,
            message,
            "fact",
            fact.id,
            fact.statement,
        )

    def add_guideline_finding(
        match: re.Match,
        check: str,
        message: str,
    ) -> None:
        add_finding(
            match.group(0).strip(),
            match.start(),
            match.end(),
            check,
            message,
            "guideline",
            claims_guideline.id if claims_guideline else None,
            (
                claims_guideline.description
                if claims_guideline
                else "Claims require approved evidence."
            ),
        )

    # Customer-count claims.
    count_pattern = re.compile(
        r"\b(?:(?:over|more than|above|nearly|approximately|about)\s+)?"
        r"\d+(?:,\d{3})*(?:\.\d+)?\s*"
        r"(?:million|billion|thousand)\s+"
        r"(?:[a-z]+\s+){0,3}customers?\b"
        r"|\b(?:(?:over|more than|above|nearly|approximately|about)\s+)?"
        r"\d+(?:,\d{3})*(?:\.\d+)?\s+customers?\b",
        re.IGNORECASE,
    )

    customer_facts = [
        fact
        for fact in facts
        if re.search(r"\bcustomers?\b", fact.statement, re.I)
    ]

    for match in count_pattern.finditer(text):
        claimed_values = _numbers(match.group(0))
        claimed_number = claimed_values[0] if claimed_values else 0.0

        matching_fact = next(
            (
                fact
                for fact in customer_facts
                if _numbers(fact.statement)
                and claimed_number > _numbers(fact.statement)[0]
            ),
            None,
        )

        if matching_fact:
            add_fact_finding(
                match,
                matching_fact,
                "Customer-count claim exceeds the approved fact: "
                f"{matching_fact.statement}",
            )
        elif not customer_facts:
            add_guideline_finding(
                match,
                "unsupported_claim",
                "No approved customer-count fact supports this claim.",
            )

    # Percentage claims.
    percentage_pattern = re.compile(r"\b\d+(?:\.\d+)?\s*%", re.I)

    percentage_facts = [
        fact
        for fact in facts
        if "%" in fact.statement
        or re.search(r"\bpercent\b", fact.statement, re.I)
    ]

    for match in percentage_pattern.finditer(text):
        claimed_number = float(
            re.search(r"\d+(?:\.\d+)?", match.group(0)).group()
        )

        # Examine the nearby draft text to avoid matching unrelated facts.
        claim_start = max(0, match.start() - 100)
        claim_end = min(len(text), match.end() + 100)
        claim_context = text[claim_start:claim_end].lower()

        relevant_facts = []

        for fact in percentage_facts:
            fact_words = re.findall(
                r"\b[a-zA-Z]{4,}\b",
                fact.statement.lower(),
            )

            meaningful_words = [
                word
                for word in fact_words
                if word not in {"than", "with", "from", "uses", "using"}
            ]

            if any(word in claim_context for word in meaningful_words):
                relevant_facts.append(fact)

        matching_fact = next(
            (
                fact
                for fact in relevant_facts
                if any(
                    claimed_number > float(value)
                    for value in re.findall(
                        r"\d+(?:\.\d+)?(?=\s*%)",
                        fact.statement,
                    )
                )
            ),
            None,
        )

        if matching_fact:
            add_fact_finding(
                match,
                matching_fact,
                "Percentage claim exceeds the approved fact: "
                f"{matching_fact.statement}",
            )
        elif not relevant_facts:
            add_guideline_finding(
                match,
                "unsupported_claim",
                "No relevant approved fact supports this percentage claim.",
            )

    # Superlatives require approved evidence.
    superlative_pattern = re.compile(
        r"\b(?:best|greatest|number\s+one|most|leading)\b|#\s*1",
        re.I,
    )

    for match in superlative_pattern.finditer(text):
        add_guideline_finding(
            match,
            "unsupported_claim",
            "Superlative claims require approved evidence.",
        )

    # Lifetime guarantees are not supported by the demo's facts.
    guarantee_pattern = re.compile(
        r"\b(?:guaranteed?\s+to\s+last\s+forever|"
        r"last\s+forever|guaranteed\s+forever|never\s+fail)\b",
        re.I,
    )

    guarantee_facts = [
        fact
        for fact in facts
        if re.search(r"\bguarantee|guaranteed\b", fact.statement, re.I)
    ]

    for match in guarantee_pattern.finditer(text):
        outdated_fact = next(
            (
                fact
                for fact in guarantee_facts
                if _fact_is_outdated(fact)
            ),
            None,
        )

        if outdated_fact:
            add_fact_finding(
                match,
                outdated_fact,
                "This claim references an outdated guarantee fact: "
                f"{outdated_fact.statement}",
            )
        else:
            source_fact = guarantee_facts[0] if guarantee_facts else None

            add_finding(
                match.group(0),
                match.start(),
                match.end(),
                "unsupported_claim",
                "The claim makes an unsupported lifetime guarantee.",
                "fact" if source_fact else "guideline",
                (
                    source_fact.id
                    if source_fact
                    else claims_guideline.id
                    if claims_guideline
                    else None
                ),
                (
                    source_fact.statement
                    if source_fact
                    else claims_guideline.description
                    if claims_guideline
                    else "Claims require approved evidence."
                ),
            )

    return sorted(findings, key=lambda item: item["start_offset"])
