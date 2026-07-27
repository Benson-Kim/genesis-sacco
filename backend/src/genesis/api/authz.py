"""Deny-by-default authorization (gate 1.6).

Every business route MUST carry a RequirePermission dependency; a CI test
walks the route table and fails if any operation lacks one.
"""

from __future__ import annotations

from fastapi import Request

from genesis.application import rbac as rbac_service
from genesis.application.auth import AuthContext, decode_access_token
from genesis.domain.rbac import Action, Module
from genesis.errors import ForbiddenError, UnauthenticatedError
from genesis.infrastructure.db import get_sessionmaker
from genesis.infrastructure.tenancy import tenant_session
from genesis.settings import get_settings


def get_auth_context(request: Request) -> AuthContext:
    """Authentication only; use RequirePermission for authorization."""
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise UnauthenticatedError("missing bearer token")
    return decode_access_token(header[7:])


class RequirePermission:
    """FastAPI dependency enforcing role x module x action server-side."""

    def __init__(self, module: Module, action: Action) -> None:
        self.module = module
        self.action = action

    async def __call__(self, request: Request) -> AuthContext:
        ctx = get_auth_context(request)
        factory = get_sessionmaker(get_settings().database_url)
        async with tenant_session(factory, ctx.tenant_id) as session:
            allowed = await rbac_service.has_permission(
                session, ctx.role_id, self.module, self.action
            )
        if not allowed:
            raise ForbiddenError(f"{self.module.value}:{self.action.value}")
        return ctx
