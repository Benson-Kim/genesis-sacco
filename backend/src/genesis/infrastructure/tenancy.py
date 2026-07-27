"""Per-request tenant scoping via Postgres RLS (ADR-0002, gate 1.6)."""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


@asynccontextmanager
async def tenant_session(
    session_factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
) -> AsyncIterator[AsyncSession]:
    """Yield a session whose transaction is scoped to exactly one tenant.

    set_config(..., true) is equivalent to SET LOCAL: the GUC is bound to the
    current transaction only, so pooled connections can never leak tenant
    context between requests. Commits on success, rolls back on error.
    """
    async with session_factory() as session, session.begin():
        await session.execute(
            text("SELECT set_config('app.tenant_id', :tid, true)"),
            {"tid": str(tenant_id)},
        )
        yield session
