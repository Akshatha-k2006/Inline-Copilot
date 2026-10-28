from ipaddress import ip_address
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from app.config import settings


class Principal:
    def __init__(self, role: str, user: str | None) -> None:
        self.role = role
        self.user = user


def get_role(x_role: Annotated[str | None, Header()] = None) -> str:
    """Read the simulated role for the local demo; this is not authentication."""
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
