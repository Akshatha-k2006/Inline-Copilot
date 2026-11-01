from sqlalchemy.orm import Session

from app.models import Content, ContentImage

SUGGESTED_FIX_TEMPLATE = (
    "Add descriptive alt text for '{filename}' so screen readers can describe it."
)


def check_accessibility(db: Session, content: Content) -> list[dict]:
    """Flag attached images whose alt text is missing or whitespace-only."""
    images = (
        db.query(ContentImage)
        .filter(ContentImage.content_id == content.id)
        .order_by(ContentImage.id)
        .all()
    )
    findings = []
    for image in images:
        if image.alt_text and image.alt_text.strip():
            continue
        findings.append(
            {
                "check": "accessibility",
                "severity": "warning",
                "message": f"Image '{image.filename}' is missing alt text.",
                "matched_text": image.filename,
                "start_offset": None,
                "end_offset": None,
                "suggested_fix": SUGGESTED_FIX_TEMPLATE.format(
                    filename=image.filename
                ),
                "evidence": {},
                "source": {
                    "type": "image",
                    "id": image.id,
                    "text": image.filename,
                },
            }
        )
    return findings
