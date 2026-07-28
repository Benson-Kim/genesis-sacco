"""Staff user list endpoint for the access-control panel (P4)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from genesis.api.authz import RequirePermission
from genesis.application.auth import AuthContext
from genesis.domain.rbac import Action, Module
from genesis.infrastructure.db import get_sessionmaker
from genesis.infrastructure.tenancy import tenant_session
from genesis.settings import get_settings

from sqlalchemy import text

router = APIRouter(prefix="/access", tags=["access"])

_view_access = RequirePermission(Module.ACCESS_CONTROL, Action.VIEW)
ViewCtx = Annotated[AuthContext, Depends(_view_access)]


class UserOut(BaseModel):
    id: str
    full_name: str
    email: str
    branch: str | None
    role_name: str
    status: str
    last_active: str | None


@router.get("/users")
async def get_users(ctx: ViewCtx) -> list[UserOut]:
    """List all staff users for the tenant, joining roles for the role name."""
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        rows = (
            await session.execute(
                text(
                    "SELECT u.id, u.full_name, u.email, u.branch, r.name AS role_name, "
                    "u.status, u.updated_at "
                    "FROM users u JOIN roles r ON r.id = u.role_id "
                    "ORDER BY u.full_name"
                )
            )
        ).all()
    return [
        UserOut(
            id=str(r[0]),
            full_name=str(r[1]),
            email=str(r[2]),
            branch=str(r[3]) if r[3] else None,
            role_name=str(r[4]),
            status=str(r[5]),
            last_active=r[6].isoformat() if r[6] else None,
        )
        for r in rows
    ]
