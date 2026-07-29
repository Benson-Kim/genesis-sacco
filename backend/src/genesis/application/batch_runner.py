"""Shared keyset batch-loop scaffolding for per-tenant jobs (P10/P11, DRY).

The arrears job (P10) and the deposit-interest job (P11) both walk a
tenant's rows in bounded id-keyset batches, each batch inside its own
short transaction (gate 1.3). This module owns that loop exactly once:
the caller injects a session scope (e.g.
functools.partial(tenant_session, factory, tenant_id)), so neither this
module nor the jobs import infrastructure (P10 precedent), and supplies
a process_batch coroutine that does the domain work for one batch.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from typing import TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

SessionScope = Callable[[], AbstractAsyncContextManager[AsyncSession]]

T = TypeVar("T")

#: One batch of work: (session, keyset cursor) -> (rows scanned, new
#: cursor, job-specific payload). The payload carries whatever the job
#: accumulates per batch (e.g. update counts, posted totals).
BatchProcessor = Callable[
    [AsyncSession, uuid.UUID | None],
    Awaitable[tuple[int, uuid.UUID | None, T]],
]


async def run_in_batches(
    session_scope: SessionScope,
    process_batch: BatchProcessor[T],
    *,
    batch_size: int,
) -> tuple[int, int, list[T]]:
    """Drive process_batch to exhaustion; returns (scanned, batches, payloads).

    Each batch runs in its own transaction via session_scope (gate 1.3:
    no long transactions). The loop stops when a batch scans fewer rows
    than batch_size. Payloads are collected only for non-empty batches,
    mirroring the batches counter.
    """
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    scanned = 0
    batches = 0
    payloads: list[T] = []
    after_id: uuid.UUID | None = None
    while True:
        async with session_scope() as session:
            batch_scanned, after_id, payload = await process_batch(session, after_id)
        scanned += batch_scanned
        if batch_scanned:
            batches += 1
            payloads.append(payload)
        if batch_scanned < batch_size:
            return scanned, batches, payloads
