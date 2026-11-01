from typing import Annotated

from fastapi import Depends, Header, HTTPException


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

    return role


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
