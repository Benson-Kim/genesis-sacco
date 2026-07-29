"""Shared DB-backed helpers for the P13 export test suite (not a test module)."""

import uuid
from functools import partial

from sqlalchemy import text

from db_helpers import factory, seed_user, unique_email
from genesis.application.auth import AuthContext, issue_access_token
from genesis.application.exports import ExportCycleSummary, run_pending_exports
from genesis.application.rbac import seed_permissions
from genesis.infrastructure.tenancy import tenant_session, tenant_snapshot_session


async def seed_actor(role_name: str = "System Admin") -> tuple[uuid.UUID, uuid.UUID, str]:
    """Tenant + seeded permissions + bearer token; returns (tid, user_id, token)."""
    email = unique_email()
    tid, role_id = await seed_user(email, role_name=role_name)
    async with tenant_session(factory(), tid) as session:
        await seed_permissions(session, tid)
        user_id = (
            await session.execute(
                text("SELECT id FROM users WHERE email = :email"), {"email": email}
            )
        ).scalar_one()
    uid = uuid.UUID(str(user_id))
    token = issue_access_token(AuthContext(user_id=uid, tenant_id=tid, role_id=role_id))
    return tid, uid, token


async def add_user(tid: uuid.UUID, role_name: str) -> tuple[uuid.UUID, str]:
    """Extra user in an existing tenant (roles were seeded by seed_actor)."""
    user_id = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        role_id = (
            await session.execute(
                text("SELECT id FROM roles WHERE name = :name"), {"name": role_name}
            )
        ).scalar_one()
        await session.execute(
            text(
                "INSERT INTO users (id, tenant_id, role_id, full_name, email) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:rid AS uuid), "
                "'Extra User', :email)"
            ),
            {
                "id": str(user_id),
                "tid": str(tid),
                "rid": str(role_id),
                "email": unique_email(),
            },
        )
        rid = uuid.UUID(str(role_id))
    token = issue_access_token(AuthContext(user_id=user_id, tenant_id=tid, role_id=rid))
    return user_id, token


async def seed_member(
    tid: uuid.UUID,
    *,
    name: str = "Report Member",
    deposit: str = "0",
    shares: str = "0",
) -> uuid.UUID:
    mid = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO members (id, tenant_id, member_no, type, name) VALUES "
                "(CAST(:id AS uuid), CAST(:tid AS uuid), :no, 'person', :name)"
            ),
            {"id": str(mid), "tid": str(tid), "no": f"GP-{mid.hex[:6].upper()}", "name": name},
        )
        for table, bal in (("deposit_accounts", deposit), ("share_accounts", shares)):
            await session.execute(
                text(
                    # Table name from test code, never user input.
                    f"INSERT INTO {table} (id, tenant_id, member_id, balance) VALUES "  # noqa: S608
                    "(CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:m AS uuid), :bal)"
                ),
                {"id": str(uuid.uuid4()), "tid": str(tid), "m": str(mid), "bal": bal},
            )
    return mid


async def drain_export_queue(tid: uuid.UUID) -> ExportCycleSummary:
    """Run the real worker path: snapshot transactions per job."""
    return await run_pending_exports(partial(tenant_snapshot_session, factory(), tid), tid)


async def count(tid: uuid.UUID, sql: str, **params: object) -> int:
    async with tenant_session(factory(), tid) as session:
        value = (await session.execute(text(sql), params)).scalar_one()
    return int(value)
