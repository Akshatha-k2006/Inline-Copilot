import re

from sqlalchemy.orm import Session

from app.models import Asset, Content, ContentImage, Guideline

SUGGESTED_FIX_TEMPLATE = (
    "Add descriptive alt text for '{filename}' so screen readers can describe it."
)
HEX_COLOR_PATTERN = re.compile(
    r"(?<![0-9A-Fa-f])#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})(?![0-9A-Fa-f])"
)
CONTRAST_THRESHOLDS = {"normal": 4.5, "large": 3.0}


def normalize_hex_color(color: str) -> str:
    """Return a six-digit uppercase hex color from #RGB or #RRGGBB."""
    value = color.removeprefix("#")
    if len(value) == 3:
        value = "".join(channel * 2 for channel in value)
    return f"#{value.upper()}"


def relative_luminance(color: str) -> float:
    """Calculate WCAG relative luminance for an opaque sRGB hex color."""
    normalized = normalize_hex_color(color)
    channels = [
        int(normalized[index : index + 2], 16) / 255
        for index in (1, 3, 5)
    ]
    linear_channels = [
        channel / 12.92
        if channel <= 0.04045
        else ((channel + 0.055) / 1.055) ** 2.4
        for channel in channels
    ]
    return sum(
        weight * channel
        for weight, channel in zip((0.2126, 0.7152, 0.0722), linear_channels)
    )


def contrast_ratio(foreground_color: str, background_color: str) -> float:
    """Calculate the WCAG contrast ratio between two opaque sRGB colors."""
    foreground_luminance = relative_luminance(foreground_color)
    background_luminance = relative_luminance(background_color)
    lighter = max(foreground_luminance, background_luminance)
    darker = min(foreground_luminance, background_luminance)
    return (lighter + 0.05) / (darker + 0.05)


def get_brand_palette(db: Session) -> list[str]:
    """Extract unique hex colors from configured palette asset descriptions."""
    assets = (
        db.query(Asset)
        .filter(Asset.asset_type == "palette")
        .order_by(Asset.id)
        .all()
    )
    colors = []
    seen = set()
    for asset in assets:
        for color in HEX_COLOR_PATTERN.findall(asset.description or ""):
            normalized = normalize_hex_color(color)
            if normalized not in seen:
                colors.append(normalized)
                seen.add(normalized)
    return colors


def suggest_palette_pair(
    foreground_color: str,
    background_color: str,
    palette: list[str],
    required_ratio: float,
) -> dict | None:
    """Choose the compliant palette pair that changes the fewest input colors."""
    candidates = []
    for foreground_index, candidate_foreground in enumerate(palette):
        for background_index, candidate_background in enumerate(palette):
            ratio = contrast_ratio(candidate_foreground, candidate_background)
            if ratio < required_ratio:
                continue
            changed_colors = sum(
                (
                    candidate_foreground != foreground_color,
                    candidate_background != background_color,
                )
            )
            candidates.append(
                (
                    changed_colors,
                    -ratio,
                    foreground_index,
                    background_index,
                    candidate_foreground,
                    candidate_background,
                    ratio,
                )
            )
    if not candidates:
        return None

    (
        _,
        _,
        _,
        _,
        suggested_foreground,
        suggested_background,
        suggested_ratio,
    ) = min(candidates)
    return {
        "foreground_color": suggested_foreground,
        "background_color": suggested_background,
        "contrast_ratio": round(suggested_ratio, 2),
    }


def check_contrast(
    db: Session,
    foreground_color: str,
    background_color: str,
    text_size: str,
) -> dict:
    """Check a color pair against WCAG AA and suggest compliant palette colors."""
    normalized_foreground = normalize_hex_color(foreground_color)
    normalized_background = normalize_hex_color(background_color)
    required_ratio = CONTRAST_THRESHOLDS[text_size]
    ratio = contrast_ratio(normalized_foreground, normalized_background)
    palette = get_brand_palette(db)

    palette_set = set(palette)
    is_compliant = ratio >= required_ratio
    suggested_replacement = None
    finding = None
    if not is_compliant:
        suggested_replacement = suggest_palette_pair(
            normalized_foreground,
            normalized_background,
            palette,
            required_ratio,
        )
        if suggested_replacement:
            suggested_fix = (
                "Use foreground "
                f"{suggested_replacement['foreground_color']} and background "
                f"{suggested_replacement['background_color']} "
                f"({suggested_replacement['contrast_ratio']:.2f}:1 contrast)."
            )
        else:
            suggested_fix = (
                "No brand palette colors are configured, so a palette-based "
                "replacement cannot be suggested."
                if not palette
                else
                "No foreground/background combination in the configured brand "
                f"palette meets the {required_ratio:.1f}:1 requirement."
            )
        finding = {
            "check": "accessibility",
            "severity": "warning",
            "message": (
                f"Contrast ratio {ratio:.2f}:1 does not meet WCAG AA for "
                f"{text_size}-text (requires {required_ratio:.1f}:1)."
            ),
            "suggested_fix": suggested_fix,
        }

    return {
        "foreground_color": normalized_foreground,
        "background_color": normalized_background,
        "text_size": text_size,
        "contrast_ratio": round(ratio, 2),
        "required_ratio": required_ratio,
        "passes": is_compliant,
        "brand_palette_match": {
            "foreground": normalized_foreground in palette_set,
            "background": normalized_background in palette_set,
        },
        "finding": finding,
        "suggested_replacement": suggested_replacement,
    }


def check_accessibility(db: Session, content: Content) -> list[dict]:
    """Flag attached images whose alt text is missing or whitespace-only."""
    images = (
        db.query(ContentImage)
        .filter(ContentImage.content_id == content.id)
        .order_by(ContentImage.id)
        .all()
    )
    findings = []
    accessibility_guideline = None
    accessibility_guideline_checked = False
    for image in images:
        if image.alt_text and image.alt_text.strip():
            continue
        if not accessibility_guideline_checked:
            accessibility_guideline = (
                db.query(Guideline)
                .filter(
                    (Guideline.category.ilike("accessibility"))
                    | (Guideline.title.ilike("%accessibility%"))
                    | (Guideline.title.ilike("%alt text%"))
                )
                .order_by(Guideline.id)
                .first()
            )
            accessibility_guideline_checked = True
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
                "guideline_id": (
                    accessibility_guideline.id
                    if accessibility_guideline
                    else None
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
