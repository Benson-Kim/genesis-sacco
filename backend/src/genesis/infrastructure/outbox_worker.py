"""Outbox dispatcher: retry with backoff + jitter, dead-letter after N (P5).

Claiming happens in a short transaction touching ONLY outbox rows and is
committed before any provider call, so dispatch never holds domain row
locks (gate 1.4). Providers are called through adapters that are
idempotent by event id (gate 1.2).
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import traceback
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from genesis.infrastructure.providers import NotificationProvider
from genesis.infrastructure.tenancy import tenant_session

logger = logging.getLogger("genesis.infrastructure.outbox")

MAX_ATTEMPTS = 8
BASE_BACKOFF_SECONDS = 30
CLAIM_LEASE_SECONDS = 300


def backoff_delay(attempts: int, jitter: float) -> float:
    """Exponential backoff with jitter in [0.5x, 1x] of the raw delay."""
    return float(BASE_BACKOFF_SECONDS * (2**attempts)) * (0.5 + jitter / 2)


def _jitter() -> float:
    return secrets.randbelow(1000) / 1000


@dataclass(frozen=True)
class OutboxMetrics:
    pending: int
    dead: int
    dispatched: int
    oldest_pending_seconds: float


async def dispatch_due(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    provider: NotificationProvider,
    *,
    batch_size: int = 20,
) -> int:
    """Dispatch due pending events for one tenant; returns the delivered count.

    Phase 1 claims a batch (SKIP LOCKED + lease) and commits. Phase 2 calls
    the provider outside any transaction. Phase 3 records the outcome in a
    fresh short transaction per event.
    """
    async with tenant_session(factory, tenant_id) as session:
        rows = (
            await session.execute(
                text(
                    "SELECT id, event_type, payload, attempts FROM outbox_events "
                    "WHERE status = 'pending' AND next_attempt_at <= now() "
                    "ORDER BY next_attempt_at LIMIT :limit FOR UPDATE SKIP LOCKED"
                ),
                {"limit": batch_size},
            )
        ).all()
        claimed = [(str(r[0]), str(r[1]), dict(r[2]), int(r[3])) for r in rows]
        for event_id, _, _, _ in claimed:
            await session.execute(
                text(
                    "UPDATE outbox_events "
                    "SET next_attempt_at = now() + make_interval(secs => :lease) "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {"lease": CLAIM_LEASE_SECONDS, "id": event_id},
            )
    delivered = 0
    for event_id, event_type, payload, attempts in claimed:
        try:
            await provider.send(event_id, event_type, payload)
        except Exception:
            logger.exception("outbox dispatch failed for event %s", event_id)
            await _record_failure(
                factory,
                tenant_id,
                event_id,
                attempts + 1,
                traceback.format_exc(limit=3)[:1000],
            )
        else:
            delivered += 1
            async with tenant_session(factory, tenant_id) as session:
                await session.execute(
                    text(
                        "UPDATE outbox_events SET status = 'dispatched', "
                        "dispatched_at = now(), attempts = :attempts "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {"attempts": attempts + 1, "id": event_id},
                )
    return delivered


async def _record_failure(
    factory: async_sessionmaker[AsyncSession],
    tenant_id: uuid.UUID,
    event_id: str,
    attempts: int,
    error_text: str,
) -> None:
    async with tenant_session(factory, tenant_id) as session:
        if attempts >= MAX_ATTEMPTS:
            await session.execute(
                text(
                    "UPDATE outbox_events SET status = 'dead', attempts = :attempts, "
                    "last_error = :err WHERE id = CAST(:id AS uuid)"
                ),
                {"attempts": attempts, "err": error_text, "id": event_id},
            )
            logger.error("outbox event dead-lettered: %s", event_id)
            return
        delay = backoff_delay(attempts, _jitter())
        await session.execute(
            text(
                "UPDATE outbox_events SET attempts = :attempts, last_error = :err, "
                "next_attempt_at = now() + make_interval(secs => :delay) "
                "WHERE id = CAST(:id AS uuid)"
            ),
            {"attempts": attempts, "err": error_text, "delay": delay, "id": event_id},
        )


async def outbox_metrics(
    factory: async_sessionmaker[AsyncSession], tenant_id: uuid.UUID
) -> OutboxMetrics:
    """Lag and failure metrics; P21 wires these into exporters and alerts."""
    async with tenant_session(factory, tenant_id) as session:
        row = (
            await session.execute(
                text(
                    "SELECT "
                    "count(*) FILTER (WHERE status = 'pending') AS pending, "
                    "count(*) FILTER (WHERE status = 'dead') AS dead, "
                    "count(*) FILTER (WHERE status = 'dispatched') AS dispatched, "
                    "coalesce(extract(epoch FROM now() - min(created_at) "
                    "FILTER (WHERE status = 'pending')), 0) AS oldest "
                    "FROM outbox_events"
                )
            )
        ).one()
    return OutboxMetrics(
        pending=int(row[0]),
        dead=int(row[1]),
        dispatched=int(row[2]),
        oldest_pending_seconds=float(row[3]),
    )


async def list_active_tenants(
    factory: async_sessionmaker[AsyncSession],
) -> list[uuid.UUID]:
    """Tenant registry via the SECURITY DEFINER function (migration 0003)."""
    async with factory() as session:
        rows = (await session.execute(text("SELECT active_tenant_ids()"))).scalars().all()
    return [uuid.UUID(str(value)) for value in rows]


async def run_dispatch_cycle(
    factory: async_sessionmaker[AsyncSession], provider: NotificationProvider
) -> int:
    delivered = 0
    for tenant_id in await list_active_tenants(factory):
        delivered += await dispatch_due(factory, tenant_id, provider)
    return delivered


async def run_worker(
    factory: async_sessionmaker[AsyncSession],
    provider: NotificationProvider,
    *,
    interval_seconds: float = 5.0,
    stop: asyncio.Event | None = None,
) -> None:
    """Long-running dispatcher loop; deployed as the worker process."""
    while stop is None or not stop.is_set():
        try:
            await run_dispatch_cycle(factory, provider)
        except Exception:
            logger.exception("outbox dispatch cycle failed")
        await asyncio.sleep(interval_seconds)
