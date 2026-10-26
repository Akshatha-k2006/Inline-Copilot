from copy import deepcopy


def _valid_span(text: str, finding: dict) -> bool:
    start = finding.get("start_offset")
    end = finding.get("end_offset")
    matched_text = finding.get("matched_text")
    return (
        isinstance(start, int)
        and not isinstance(start, bool)
        and isinstance(end, int)
        and not isinstance(end, bool)
        and 0 <= start < end <= len(text)
        and isinstance(matched_text, str)
        and text[start:end] == matched_text
    )


def _is_slang_without_replacement(finding: dict) -> bool:
    source = finding.get("source")
    if not isinstance(source, dict):
        return False
    explanation = " ".join(
        str(source.get(key, ""))
        for key in ("explanation", "text", "term")
    ).lower()
    return any(
        marker in explanation
        for marker in ("slang", "text-speak", "text speak")
    )


def _replacement_is_phrase_only(text: str, finding: dict, replacement: str) -> bool:
    start = finding["start_offset"]
    end = finding["end_offset"]
    before = text[max(0, start - 30):start].strip()
    after = text[end:min(len(text), end + 30)].strip()
    return (
        "\n" not in replacement
        and (not before or before not in replacement)
        and (not after or after not in replacement)
        and replacement != finding["matched_text"]
    )


def generate_suggestions(text: str, findings: list[dict]) -> list[dict]:
    """Choose safe replacement spans or mark findings for manual review."""
    result = []
    for original in findings:
        finding = deepcopy(original)
        evidence = finding.get("evidence")
        if not isinstance(evidence, dict):
            evidence = {}
            finding["evidence"] = evidence

        if not _valid_span(text, finding):
            finding["suggested_fix"] = None
            finding["suggestion_source"] = None
            evidence["requires_manual_review"] = True
            result.append(finding)
            continue

        source = finding.get("source")
        suggestion = finding.get("suggested_fix")
        suggestion_source = finding.get("suggestion_source")
        check = finding.get("check")

        if check == "terminology":
            preferred = source.get("preferred_term") if isinstance(source, dict) else None
            if isinstance(preferred, str) and preferred:
                suggestion = preferred
            elif _is_slang_without_replacement(finding):
                suggestion = ""
            else:
                suggestion = None
        elif check in {"unsupported_claim", "outdated_info"}:
            if (
                not isinstance(suggestion, str)
                or not isinstance(suggestion_source, dict)
                or suggestion_source.get("type") != "fact"
                or not isinstance(suggestion_source.get("id"), int)
                or not suggestion
            ):
                suggestion = None
                suggestion_source = None
        elif check in {"tone", "messaging"}:
            if not isinstance(suggestion, str) or not suggestion:
                suggestion = None
        else:
            suggestion = None

        if suggestion is not None and not _replacement_is_phrase_only(
            text,
            finding,
            suggestion,
        ):
            suggestion = None

        finding["suggested_fix"] = suggestion
        finding["suggestion_source"] = suggestion_source if suggestion else None
        evidence["requires_manual_review"] = suggestion is None
        result.append(finding)

    return result
