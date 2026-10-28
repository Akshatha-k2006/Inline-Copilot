from ipaddress import ip_address
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from app.config import settings


class Principal:
    def __init__(self, role: str, user: str | None) -> None:
        self.role = role
        self.user = user


def get_authenticated_principal(
    request: Request,
    x_role: Annotated[str | None, Header()] = None,
    x_user: Annotated[str | None, Header()] = None,
) -> Principal:
    if settings.app_env == "production":
        raise HTTPException(
            status_code=401,
            detail={
                "error": "authentication_not_configured",
                "message": "Authentication is not configured; API access is disabled.",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    if settings.app_env == "development":
        host = request.client.host if request.client else ""
        try:
            is_loopback = ip_address(host).is_loopback
        except ValueError:
            is_loopback = False
        if not is_loopback:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "local_development_only",
                    "message": "Development role headers are accepted only from a local client.",
                },
            )

    role = (x_role or "").strip().lower()
    if role not in {"admin", "brand_manager", "creator", "reviewer"}:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "A valid role is required.",
            },
        )

    return Principal(role=role, user=x_user)


def get_role(
    principal: Annotated[Principal, Depends(get_authenticated_principal)],
) -> str:
    return principal.role


def require_writer(role: Annotated[str, Depends(get_role)]) -> str:
    if role not in {"admin", "brand_manager"}:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "forbidden",
                "message": "Only Admin or Brand Manager can modify the knowledge base.",
            },
        )

    return role
