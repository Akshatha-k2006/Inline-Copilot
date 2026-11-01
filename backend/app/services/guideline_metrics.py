from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import FindingDecisionEvent, FindingReviewEvent, Guideline

DECISIONS = ("accepted", "dismissed", "resolved")
HIGH_DISMISSAL_RATE = 0.5
MINIMUM_DECISIONS_FOR_DISMISSAL_SIGNAL = 3


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _rates(decision_counts: dict[str, int]) -> dict:
    decision_count = sum(decision_counts.values())
    dismissed_count = decision_counts["dismissed"]
    return {
        "decision_count": decision_count,
        "dismissed_count": dismissed_count,
        "dismissal_rate": (
            round(dismissed_count / decision_count, 4)
            if decision_count
            else None
        ),
    }


def calculate_guideline_metrics(
    db: Session,
    period_days: int = 30,
    stale_after_days: int = 90,
    now: datetime | None = None,
) -> dict:
    """Aggregate immutable finding and decision events by configured guideline."""
    current_time = _utc(now or datetime.now(timezone.utc))
    period_start = current_time - timedelta(days=period_days)
    stale_cutoff = current_time - timedelta(days=stale_after_days)

    guidelines = db.scalars(select(Guideline).order_by(Guideline.id)).all()
    findings_in_period = db.execute(
        select(
            FindingReviewEvent.guideline_id,
            FindingReviewEvent.guideline_title,
            FindingReviewEvent.check_type,
            FindingReviewEvent.severity,
        ).where(
            FindingReviewEvent.occurred_at >= period_start,
            FindingReviewEvent.occurred_at <= current_time,
        )
    ).all()
    latest_reviews = db.execute(
        select(
            FindingReviewEvent.guideline_id,
            func.max(FindingReviewEvent.occurred_at),
        )
        .where(FindingReviewEvent.guideline_id.is_not(None))
        .group_by(FindingReviewEvent.guideline_id)
    ).all()
    decisions_in_period = db.execute(
        select(
            FindingDecisionEvent.guideline_id,
            FindingDecisionEvent.decision,
        ).where(
            FindingDecisionEvent.occurred_at >= period_start,
            FindingDecisionEvent.occurred_at <= current_time,
        )
    ).all()

    violation_counts: dict[int | None, int] = defaultdict(int)
    check_counts: dict[int | None, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )
    latest_reviewed: dict[int, datetime] = {}
    decision_counts: dict[int | None, dict[str, int]] = defaultdict(
        lambda: defaultdict(int)
    )

    for event in findings_in_period:
        violation_counts[event.guideline_id] += 1
        check_counts[event.guideline_id][event.check_type] += 1

    for guideline_id, occurred_at in latest_reviews:
        latest_reviewed[guideline_id] = _utc(occurred_at)

    for event in decisions_in_period:
        if event.decision in DECISIONS:
            decision_counts[event.guideline_id][event.decision] += 1

    guideline_metrics = []
    suggested_areas = []
    for guideline in guidelines:
        guideline_id = guideline.id
        last_reviewed_at = latest_reviewed.get(guideline_id)
        citation_count = violation_counts[guideline_id]
        rates = _rates(decision_counts[guideline_id])
        reasons = []
        clarification_suggestions = []

        if citation_count == 0:
            reasons.append("no_citations_in_period")
            clarification_suggestions.append(
                "Check whether this guideline is still applicable and whether "
                "its rules are being detected."
            )
        if last_reviewed_at is None or last_reviewed_at < stale_cutoff:
            reasons.append("not_reviewed_recently")
            clarification_suggestions.append(
                "Review this guideline and confirm its examples and ownership "
                "are current."
            )
        dismissal_rate = rates["dismissal_rate"]
        if (
            rates["decision_count"] >= MINIMUM_DECISIONS_FOR_DISMISSAL_SIGNAL
            and dismissal_rate is not None
            and dismissal_rate >= HIGH_DISMISSAL_RATE
        ):
            reasons.append("high_dismissal_rate")
            clarification_suggestions.append(
                "Clarify the rule's scope, examples, or suggested corrections; "
                "at least half of its recorded decisions were dismissed."
            )

        guideline_metrics.append(
            {
                "guideline_id": guideline_id,
                "title": guideline.title,
                "category": guideline.category,
                "violation_count": citation_count,
                "citation_count": citation_count,
                "citations_in_period": citation_count > 0,
                "violations_by_check": dict(
                    sorted(check_counts[guideline_id].items())
                ),
                **rates,
                "last_reviewed_at": (
                    last_reviewed_at.isoformat() if last_reviewed_at else None
                ),
                "days_since_review": (
                    (current_time - last_reviewed_at).days
                    if last_reviewed_at
                    else None
                ),
                "needs_attention": bool(reasons),
                "attention_reasons": reasons,
            }
        )
        if clarification_suggestions:
            suggested_areas.append(
                {
                    "guideline_id": guideline_id,
                    "title": guideline.title,
                    "reasons": reasons,
                    "suggestions": clarification_suggestions,
                }
            )

    all_decision_counts: dict[str, int] = defaultdict(int)
    for counts in decision_counts.values():
        for decision, count in counts.items():
            all_decision_counts[decision] += count

    total_rates = _rates(all_decision_counts)
    return {
        "period": {
            "start": period_start.isoformat(),
            "end": current_time.isoformat(),
            "days": period_days,
        },
        "stale_after_days": stale_after_days,
        "totals": {
            "violation_count": len(findings_in_period),
            "citations_by_guideline": sum(
                violation_counts[guideline.id] for guideline in guidelines
            ),
            **total_rates,
        },
        "guidelines": guideline_metrics,
        "guidelines_without_citations": [
            item["guideline_id"]
            for item in guideline_metrics
            if item["citation_count"] == 0
        ],
        "suggested_areas_for_clarification": suggested_areas,
    }
