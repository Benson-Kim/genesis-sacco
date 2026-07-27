"""Outbox dispatcher suite (P5): atomicity, retry, dead-letter, idempotency."""

import asyncio
import os
import uuid
from typing import Any

import pytest
from sqlalchemy import text

from db_helpers import factory, seed_user, unique_email
from genesis.application.outbox import enqueue_event
from genesis.infrastructure.outbox_worker import (
    MAX_ATTEMPTS,
    backoff_delay,
    dispatch_due,
    list_active_tenants,
    outbox_metrics,
    run_dispatch_cycle,
)
from genesis.infrastructure.providers import StubProvider
from genesis.infrastructure.tenancy import tenant_session

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)


class FlakyProvider:
    """Fails the first `fail_times` sends, then succeeds."""

    channel = "flaky"

    def __init__(self, fail_times: int) -> None:
        self.fail_times = fail_times
        self.calls = 0

    async def send(self, event_id: str, event_type: str, payload: dict[str, Any]) -> None:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise RuntimeError("provider outage (simulated)")


async def _reset_due(tid: uuid.UUID) -> None:
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text("UPDATE outbox_events SET next_attempt_at = now() WHERE status = 'pending'")
        )


def test_rollback_removes_event_atomically() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        with pytest.raises(RuntimeError):
            async with tenant_session(factory(), tid) as session:
                await enqueue_event(session, tid, event_type="t.atomic", payload={"k": "v"})
                raise RuntimeError("force rollback")
        async with tenant_session(factory(), tid) as session:
            count = (
                await session.execute(text("SELECT count(*) FROM outbox_events"))
            ).scalar_one()
        assert int(count) == 0

    asyncio.run(run())


def test_retry_then_success_records_attempts() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        async with tenant_session(factory(), tid) as session:
            event_id = await enqueue_event(session, tid, event_type="n.retry", payload={})
        provider = FlakyProvider(fail_times=2)
        for _ in range(3):
            await _reset_due(tid)
            await dispatch_due(factory(), tid, provider)
        async with tenant_session(factory(), tid) as session:
            row = (
                await session.execute(
                    text(
                        "SELECT status, attempts, last_error FROM outbox_events "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {"id": str(event_id)},
                )
            ).first()
        assert row is not None
        assert row[0] == "dispatched"
        assert int(row[1]) == 3
        assert row[2] is not None
        assert provider.calls == 3

    asyncio.run(run())


def test_dead_letter_after_max_attempts_and_never_repicked() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        async with tenant_session(factory(), tid) as session:
            event_id = await enqueue_event(session, tid, event_type="n.dead", payload={})
        provider = FlakyProvider(fail_times=10**6)
        for _ in range(MAX_ATTEMPTS):
            await _reset_due(tid)
            await dispatch_due(factory(), tid, provider)
        async with tenant_session(factory(), tid) as session:
            row = (
                await session.execute(
                    text(
                        "SELECT status, attempts, last_error FROM outbox_events "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {"id": str(event_id)},
                )
            ).first()
        assert row is not None
        assert row[0] == "dead"
        assert int(row[1]) == MAX_ATTEMPTS
        assert row[2] is not None
        calls_before = provider.calls
        await _reset_due(tid)
        await dispatch_due(factory(), tid, provider)
        assert provider.calls == calls_before

    asyncio.run(run())


def test_stub_provider_is_idempotent_by_event_id() -> None:
    async def run() -> None:
        provider = StubProvider()
        await provider.send("evt-1", "x", {})
        await provider.send("evt-1", "x", {})
        await provider.send("evt-2", "x", {})
        assert provider.delivered_event_ids == ["evt-1", "evt-2"]

    asyncio.run(run())


def test_backoff_grows_exponentially_within_jitter_bounds() -> None:
    assert backoff_delay(1, 0.0) == 30.0
    assert backoff_delay(1, 1.0) == 60.0
    assert backoff_delay(3, 0.0) == 120.0
    assert backoff_delay(3, 1.0) == 240.0


def test_metrics_report_lag_and_failures() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        async with tenant_session(factory(), tid) as session:
            await enqueue_event(session, tid, event_type="m.pending", payload={})
        metrics = await outbox_metrics(factory(), tid)
        assert metrics.pending == 1
        assert metrics.dead == 0
        assert metrics.oldest_pending_seconds >= 0

    asyncio.run(run())


def test_worker_cycle_covers_active_tenants() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        async with tenant_session(factory(), tid) as session:
            await enqueue_event(session, tid, event_type="n.cycle", payload={})
        tenants = await list_active_tenants(factory())
        assert tid in tenants
        provider = StubProvider()
        delivered = await run_dispatch_cycle(factory(), provider)
        assert delivered >= 1

    asyncio.run(run())
