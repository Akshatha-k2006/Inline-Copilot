from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.dependencies import get_role
from app.models import (
    AuditEvent,
    Finding,
    FindingDecisionEvent,
    Guideline,
)

router = APIRouter(prefix="/brand-manager", tags=["Brand Manager"])


def _require_brand_manager(role: str) -> None:
    if role not in {"brand_manager", "admin"}:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "Brand Manager dashboard access is restricted.",
            },
        )


@router.get("/dashboard")
def get_dashboard(
    role: Annotated[str, Depends(get_role)],
    db: Session = Depends(get_db),
    days: int = Query(default=30, ge=1, le=365),
):
    _require_brand_manager(role)
    now = datetime.now(timezone.utc)
    period_start = now - timedelta(days=days)
    previous_start = period_start - timedelta(days=days)

    guidelines = db.query(Guideline).order_by(Guideline.title).all()
    findings = (
        db.query(Finding)
        .filter(Finding.created_at >= period_start)
        .all()
    )
    previous_findings = (
        db.query(Finding)
        .filter(
            Finding.created_at >= previous_start,
            Finding.created_at < period_start,
        )
        .count()
    )
    review_count = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.action == "content_reviewed",
            AuditEvent.created_at >= period_start,
        )
        .count()
    )
    previous_review_count = (
        db.query(AuditEvent)
        .filter(
            AuditEvent.action == "content_reviewed",
            AuditEvent.created_at >= previous_start,
            AuditEvent.created_at < period_start,
        )
        .count()
    )
    decisions = (
        db.query(FindingDecisionEvent)
        .filter(FindingDecisionEvent.occurred_at >= period_start)
        .all()
    )
    dismissed = [item for item in decisions if item.decision == "dismissed"]

    grouped: dict[int | None, dict] = {}
    for finding in findings:
        key = finding.guideline_id
        item = grouped.setdefault(
            key,
            {
                "guideline_id": key,
                "guideline_name": "Unlinked rule",
                "finding_count": 0,
                "categories": {},
                "last_cited_at": None,
            },
        )
        item["finding_count"] += 1
        item["categories"][finding.check_type] = (
            item["categories"].get(finding.check_type, 0) + 1
        )
        if item["last_cited_at"] is None or finding.created_at > item["last_cited_at"]:
            item["last_cited_at"] = finding.created_at

    guideline_by_id = {item.id: item for item in guidelines}
    for item in grouped.values():
        guideline = guideline_by_id.get(item["guideline_id"])
        if guideline:
            item["guideline_name"] = guideline.title
        item["last_cited_at"] = (
            item["last_cited_at"].isoformat() if item["last_cited_at"] else None
        )

    dismissal_groups: dict[int | None, dict] = {}
    for event in decisions:
        key = event.guideline_id
        item = dismissal_groups.setdefault(
            key,
            {
                "guideline_id": key,
                "guideline_name": event.guideline_title or "Unlinked rule",
                "dismissal_count": 0,
                "decision_count": 0,
                "dismissal_reasons": [],
            },
        )
        item["decision_count"] += 1
        if event.decision == "dismissed":
            item["dismissal_count"] += 1
            reason = (event.details or {}).get("dismissal_reason")
            if reason and reason not in item["dismissal_reasons"]:
                item["dismissal_reasons"].append(reason)

    for item in dismissal_groups.values():
        item["dismissal_rate"] = round(
            item["dismissal_count"] / item["decision_count"], 4
        ) if item["decision_count"] else None

    cited_ids = {
        finding.guideline_id
        for finding in findings
        if finding.guideline_id is not None
    }
    not_cited = [
        {
            "guideline_id": item.id,
            "guideline_name": item.title,
            "last_citation_at": next(
                (
                    finding.created_at.isoformat()
                    for finding in sorted(
                        item_findings,
                        key=lambda value: value.created_at,
                        reverse=True,
                    )
                ),
                None,
            ),
            "last_reviewed_at": None,
            "reason": (
                "No findings cited this guideline in the selected period."
                if item.id not in cited_ids
                else "No recent citation activity was recorded."
            ),
        }
        for item in guidelines
        for item_findings in [[
            finding for finding in findings if finding.guideline_id == item.id
        ]]
        if item.id not in cited_ids
    ]

    clarifications = [
        {
            "guideline_id": item["guideline_id"],
            "guideline_name": item["guideline_name"],
            "suggestion": (
                "Review whether this rule needs clearer examples or scope "
                "because findings were dismissed."
            ),
            "reason": (
                f"{item['dismissal_count']} dismissal(s) recorded in the "
                f"selected {days}-day period."
            ),
            "dismissal_count": item["dismissal_count"],
            "status": "needs_review",
        }
        for item in dismissal_groups.values()
        if item["dismissal_count"] > 0
    ]

    return {
        "period": {
            "days": days,
            "start": period_start.isoformat(),
            "end": now.isoformat(),
        },
        "overview": {
            "active_guidelines": len(guidelines),
            "findings": len(findings),
            "guidelines_triggered": len(
                {finding.guideline_id for finding in findings if finding.guideline_id}
            ),
            "reviews": review_count,
            "previous_reviews": previous_review_count,
            "review_change": review_count - previous_review_count,
            "dismissed_findings": len(dismissed),
            "guidelines_needing_review": len(not_cited),
        },
        "findings_per_rule": sorted(
            grouped.values(), key=lambda item: (-item["finding_count"], item["guideline_name"])
        ),
        "frequently_dismissed": sorted(
            dismissal_groups.values(),
            key=lambda item: (-item["dismissal_count"], item["guideline_name"]),
        ),
        "not_recently_cited": not_cited,
        "not_recently_reviewed": [
            {
                "guideline_id": item.id,
                "guideline_name": item.title,
                "last_reviewed_at": None,
                "reason": "No guideline review timestamp is recorded.",
            }
            for item in guidelines
        ],
        "clarifications": sorted(
            clarifications,
            key=lambda item: (-item["dismissal_count"], item["guideline_name"]),
        ),
    }
