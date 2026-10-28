from sqlalchemy.orm import Session

from app.models import AuditEvent


def record_knowledge_change(
    db: Session,
    role: str,
    action: str,
    resource_type: str,
    resource_id: int,
    resource_name: str,
) -> None:
    db.add(
        AuditEvent(
            actor=role,
            action=f"knowledge_{resource_type}_{action}",
            details={
                "actor_role": role,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "resource_name": resource_name,
            },
        )
    )
