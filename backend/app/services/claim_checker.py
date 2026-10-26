import re

CLAIM_PATTERNS = {
    "superlative": re.compile(
        r"\b(?:best|greatest|number\s+one|#\s*1|most|leading)\b",
        re.IGNORECASE,
    ),
    "percentage": re.compile(
        r"\b\d+(?:\.\d+)?\s*%",
        re.IGNORECASE,
    ),
    "guarantee": re.compile(
        r"\b(?:guaranteed?|guarantee|promise|forever|never fail)\b",
        re.IGNORECASE,
    ),
    "customer_count": re.compile(
        r"\b(?:over|more than|above|nearly|approximately|about)?\s*"
        r"\d+(?:,\d{3})*(?:\.\d+)?\s*(?:million|billion|thousand|customers|users)\b",
        re.IGNORECASE,
    ),
}

def detect_claims(text: str) -> list[dict]:
    """Detect potentially verifiable claims without using an LLM."""
    claims = []

    for claim_type, pattern in CLAIM_PATTERNS.items():
        for match in pattern.finditer(text):
            claims.append(
                {
                    "claim_type": claim_type,
                    "text": match.group(0),
                    "start_offset": match.start(),
                    "end_offset": match.end(),
                }
            )

    return sorted(claims, key=lambda claim: claim["start_offset"])
