"""Nightly arrears job: days-past-due -> classification -> provisioning (P10).

Runs per tenant in bounded batches through the shared batch runner
(genesis.application.batch_runner), each batch inside its own short
transaction (gate 1.3: no long transactions). The caller injects a
session scope (e.g. functools.partial(tenant_session, factory, tenant_id))
so this module stays free of infrastructure imports; the worker or an
admin endpoint owns scheduling.

Idempotent by construction: a loan is written only when its computed
(days_past_due, classification, provision_pct) differs from what is
stored, so re-running for the same as_of date changes nothing.

Classification thresholds and provision percentages come exclusively
from genesis.domain.lending.classify (gate 1.1: single source of truth).
Derived prudential fields do not bump the optimistic version — like
cover_pct on applications, the job must never invalidate a concurrent
edit (documented precedent from P9).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import partial
from typing import Any, cast

from sqlalchemy import CursorResult, text
from sqlalchemy.ext.asyncio import AsyncSession

from genesis.application.audit import record_audit
from genesis.application.batch_runner import SessionScope, run_in_batches
from genesis.application.outbox import enqueue_event
from genesis.domain.lending import classify

__all__ = ["DEFAULT_BATCH_SIZE", "ArrearsRunResult", "SessionScope", "run_arrears_for_tenant"]

#: Loans reclassified per transaction. Small enough to keep each
#: transaction short; large enough to keep round trips reasonable.
DEFAULT_BATCH_SIZE = 200


@dataclass(frozen=True)
class ArrearsRunResult:
    scanned: int
    updated: int
    batches: int


async def _process_batch(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    as_of: date,
    after_id: uuid.UUID | None,
    batch_size: int,
) -> tuple[int, uuid.UUID | None, int]:
    """Classify one keyset batch of active loans; returns (scanned, last_id, updated).

    The scan walks idx_loans_active_scan (tenant_id, id WHERE status =
    'active'); the oldest-unpaid-installment subquery is served by
    idx_schedules_unpaid.

    Rows are read FOR UPDATE SKIP LOCKED (gate 1.4): days-past-due is
    computed and written under the loan row lock, so it can never
    interleave with a concurrent repayment (which takes the same lock).
    A loan mid-repayment is skipped and picked up by the next run; the
    UPDATE re-checks status = 'active' as defence in depth so a closed
    loan is never reclassified.
    """
    clause = "AND l.id > CAST(:after AS uuid) " if after_id is not None else ""
    params: dict[str, object] = {"tid": str(tenant_id), "as_of": as_of, "limit": batch_size}
    if after_id is not None:
        params["after"] = str(after_id)
    rows = (
        await session.execute(
            text(
                # Static fragments chosen in code; all values are bound parameters.
                # Explicit tenant predicate on top of RLS (defence in
                # depth, gate 1.6); also the leading column of
                # idx_loans_active_scan.
                "SELECT l.id, l.days_past_due, l.classification, l.provision_pct, "  # noqa: S608
                "(SELECT MIN(s.due_date) FROM loan_schedules s "
                " WHERE s.loan_id = l.id AND s.due_date <= :as_of "
                " AND s.paid_amount < s.total_due) AS oldest_unpaid "
                "FROM loans l "
                "WHERE l.tenant_id = CAST(:tid AS uuid) "
                f"AND l.status = 'active' {clause}"
                "ORDER BY l.id LIMIT :limit "
                "FOR UPDATE OF l SKIP LOCKED"
            ),
            params,
        )
    ).all()
    updated = 0
    for loan_id_raw, dpd_raw, cls_raw, prov_raw, oldest_unpaid in rows:
        loan_id = str(loan_id_raw)
        dpd = max(0, (as_of - oldest_unpaid).days) if oldest_unpaid is not None else 0
        computed = classify(dpd)
        stored_dpd = int(dpd_raw)
        stored_cls = str(cls_raw)
        stored_prov = Decimal(str(prov_raw))
        if (
            dpd == stored_dpd
            and computed.label.value == stored_cls
            and computed.provision_pct == stored_prov
        ):
            continue  # idempotency: identical state is never rewritten
        result = cast(
            CursorResult[Any],
            await session.execute(
                text(
                    "UPDATE loans SET days_past_due = :dpd, classification = :cls, "
                    "provision_pct = :prov, updated_at = now() "
                    "WHERE id = CAST(:id AS uuid) AND status = 'active'"
                ),
                {
                    "dpd": dpd,
                    "cls": computed.label.value,
                    "prov": str(computed.provision_pct),
                    "id": loan_id,
                },
            ),
        )
        if result.rowcount != 1:  # pragma: no cover - unreachable under the row lock
            continue
        await record_audit(
            session,
            tenant_id,
            None,
            action="loan.classified",
            entity="loans",
            entity_id=loan_id,
            before={
                "days_past_due": stored_dpd,
                "classification": stored_cls,
                "provision_pct": str(stored_prov),
            },
            after={
                "days_past_due": dpd,
                "classification": computed.label.value,
                "provision_pct": str(computed.provision_pct),
            },
        )
        if computed.label.value != stored_cls:
            await enqueue_event(
                session,
                tenant_id,
                event_type="loan.classification_changed",
                payload={
                    "loan_id": loan_id,
                    "from": stored_cls,
                    "to": computed.label.value,
                    "days_past_due": dpd,
                    "provision_pct": str(computed.provision_pct),
                },
            )
        updated += 1
    last_id = uuid.UUID(str(rows[-1][0])) if rows else None
    return len(rows), last_id, updated


async def _process_one(
    session: AsyncSession,
    after_id: uuid.UUID | None,
    *,
    tenant_id: uuid.UUID,
    as_of: date,
    batch_size: int,
) -> tuple[int, uuid.UUID | None, int]:
    """Adapter matching the shared BatchProcessor signature."""
    return await _process_batch(
        session, tenant_id, as_of=as_of, after_id=after_id, batch_size=batch_size
    )


async def run_arrears_for_tenant(
    session_scope: SessionScope,
    tenant_id: uuid.UUID,
    *,
    as_of: date,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> ArrearsRunResult:
    """Reclassify every active loan of one tenant in short batches."""
    process = partial(_process_one, tenant_id=tenant_id, as_of=as_of, batch_size=batch_size)
    scanned, batches, updates = await run_in_batches(session_scope, process, batch_size=batch_size)
    return ArrearsRunResult(scanned=scanned, updated=sum(updates), batches=batches)
