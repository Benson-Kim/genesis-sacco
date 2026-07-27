"""Idempotency-Key adversarial suite (P3, gate 1.4): exactly one effect."""

import asyncio
import os
import uuid

import pytest
from sqlalchemy import text

from db_helpers import api_client, factory, seed_user, unique_email
from genesis.infrastructure.tenancy import tenant_session

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)


async def _challenge_count(tid: uuid.UUID) -> int:
    async with tenant_session(factory(), tid) as session:
        count = (await session.execute(text("SELECT count(*) FROM otp_challenges"))).scalar_one()
    return int(count)


def test_replay_returns_stored_response_with_one_effect() -> None:
    async def run() -> None:
        email = unique_email()
        tid, _ = await seed_user(email)
        headers = {"x-tenant-id": str(tid), "idempotency-key": uuid.uuid4().hex}
        async with api_client() as client:
            first = await client.post("/auth/otp/request", json={"email": email}, headers=headers)
            second = await client.post("/auth/otp/request", json={"email": email}, headers=headers)
        assert first.status_code == 202
        assert second.status_code == 202
        assert second.headers.get("idempotency-replayed") == "true"
        assert await _challenge_count(tid) == 1

    asyncio.run(run())


def test_same_key_different_payload_conflicts() -> None:
    async def run() -> None:
        email = unique_email()
        tid, _ = await seed_user(email)
        headers = {"x-tenant-id": str(tid), "idempotency-key": uuid.uuid4().hex}
        async with api_client() as client:
            first = await client.post("/auth/otp/request", json={"email": email}, headers=headers)
            second = await client.post(
                "/auth/otp/request", json={"email": unique_email()}, headers=headers
            )
        assert first.status_code == 202
        assert second.status_code == 409

    asyncio.run(run())


def test_concurrent_identical_keys_produce_exactly_one_effect() -> None:
    async def run() -> None:
        email = unique_email()
        tid, _ = await seed_user(email)
        headers = {"x-tenant-id": str(tid), "idempotency-key": uuid.uuid4().hex}
        async with api_client() as client:
            results = await asyncio.gather(
                client.post("/auth/otp/request", json={"email": email}, headers=headers),
                client.post("/auth/otp/request", json={"email": email}, headers=headers),
            )
        statuses = sorted(r.status_code for r in results)
        assert 202 in statuses
        assert all(s in {202, 409} for s in statuses)
        assert await _challenge_count(tid) == 1

    asyncio.run(run())
