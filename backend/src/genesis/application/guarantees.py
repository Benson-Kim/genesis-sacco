"""Guarantorship services: pledge, consent, release (P9, gate 1.4).

Capacity (deposit balance minus existing pledged/active guarantees) is
computed while holding the guarantor's deposit-account row lock, so
concurrent pledges - and future balance-changing operations that take
the same lock - can never over-pledge a member.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, cast

from sqlalchemy import CursorResult, text
from sqlalchemy.ext.asyncio import AsyncSession

from genesis.application.audit import record_audit
from genesis.application.loan_applications import recompute_cover
from genesis.application.outbox import enqueue_event
from genesis.domain.lending import ApplicationStage
from genesis.domain.money import ZERO, to_cents
from genesis.errors import ConflictError, InvalidInputError, NotFoundError

#: Stages during which new pledges are accepted.
_PLEDGEABLE = frozenset(
    {ApplicationStage.SUBMITTED, ApplicationStage.APPRAISAL, ApplicationStage.COMMITTEE}
)


@dataclass(frozen=True)
class GuaranteeRecord:
    id: uuid.UUID
    application_id: uuid.UUID
    guarantor_member_id: uuid.UUID
    borrower_member_id: uuid.UUID
    amount: Decimal
    status: str
    version: int


async def live_pledged_total(
    session: AsyncSession, tenant_id: uuid.UUID, guarantor_member_id: uuid.UUID
) -> Decimal:
    """Sum of a member's live (pledged/active) guarantee amounts.

    Callers must hold the guarantor's deposit-account row lock whenever
    the result feeds a capacity decision (pledging or withdrawing), so
    the computation can never interleave with a concurrent balance
    change (gate 1.4). Shared by P9 pledging and P11 withdrawals. The
    explicit tenant predicate doubles the RLS fence on this money path
    (defence in depth, gate 1.6).
    """
    value = (
        await session.execute(
            text(
                "SELECT COALESCE(SUM(amount), 0) FROM guarantees "
                "WHERE guarantor_member_id = CAST(:g AS uuid) "
                "AND tenant_id = CAST(:tid AS uuid) "
                "AND status IN ('pledged', 'active')"
            ),
            {"g": str(guarantor_member_id), "tid": str(tenant_id)},
        )
    ).scalar_one()
    return Decimal(str(value))


async def pledge_guarantee(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    *,
    application_id: uuid.UUID,
    guarantor_member_id: uuid.UUID,
    amount: Decimal,
) -> GuaranteeRecord:
    """Pledge under the guarantor's deposit-account row lock (gate 1.4)."""
    amount = to_cents(amount)
    if amount <= ZERO:
        raise InvalidInputError("guarantee amount must be positive")
    app_row = (
        await session.execute(
            text(
                "SELECT member_id, stage FROM loan_applications "
                "WHERE id = CAST(:id AS uuid) "
                "AND tenant_id = CAST(:tid AS uuid) FOR UPDATE"
            ),
            {"id": str(application_id), "tid": str(tenant_id)},
        )
    ).first()
    if app_row is None:
        raise NotFoundError(f"loan application {application_id} not found")
    borrower_id = uuid.UUID(str(app_row[0]))
    stage = ApplicationStage(str(app_row[1]))
    if stage not in _PLEDGEABLE:
        raise ConflictError(f"application in stage '{stage.value}' no longer accepts pledges")
    if guarantor_member_id == borrower_id:
        raise InvalidInputError("a member cannot guarantee their own loan")
    guarantor_row = (
        await session.execute(
            # FOR SHARE holds off a concurrent terminal member exit
            # (which locks the row FOR UPDATE) until this pledge commits,
            # closing the TOCTOU window between the status check and the
            # insert (gate 1.4).
            text(
                "SELECT status FROM members WHERE id = CAST(:m AS uuid) "
                "AND tenant_id = CAST(:tid AS uuid) FOR SHARE"
            ),
            {"m": str(guarantor_member_id), "tid": str(tenant_id)},
        )
    ).first()
    if guarantor_row is None:
        raise NotFoundError(f"guarantor member {guarantor_member_id} not found")
    if str(guarantor_row[0]) != "active":
        raise ConflictError(
            f"guarantor {guarantor_member_id} is '{guarantor_row[0]}': "
            "only active members may pledge"
        )
    # Serialisation point: every capacity computation for this guarantor
    # happens while holding this row lock.
    balance_row = (
        await session.execute(
            text(
                "SELECT balance FROM deposit_accounts WHERE member_id = CAST(:m AS uuid) "
                "AND tenant_id = CAST(:tid AS uuid) FOR UPDATE"
            ),
            {"m": str(guarantor_member_id), "tid": str(tenant_id)},
        )
    ).first()
    if balance_row is None:
        raise NotFoundError(f"guarantor {guarantor_member_id} has no deposit account")
    balance = Decimal(str(balance_row[0]))
    pledged = await live_pledged_total(session, tenant_id, guarantor_member_id)
    available = balance - pledged
    if amount > available:
        # Least disclosure (gate 1.6): the available capacity derives from
        # the guarantor's deposit balance and is never echoed to callers.
        raise ConflictError(
            f"insufficient guarantor capacity: requested {amount} exceeds available capacity"
        )
    guarantee_id = uuid.uuid4()
    await session.execute(
        text(
            "INSERT INTO guarantees "
            "(id, tenant_id, guarantor_member_id, borrower_member_id, "
            " application_id, amount) "
            "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:g AS uuid), "
            "CAST(:b AS uuid), CAST(:a AS uuid), :amount)"
        ),
        {
            "id": str(guarantee_id),
            "tid": str(tenant_id),
            "g": str(guarantor_member_id),
            "b": str(borrower_id),
            "a": str(application_id),
            "amount": str(amount),
        },
    )
    await record_audit(
        session,
        tenant_id,
        actor_id,
        action="guarantee.pledge",
        entity="guarantees",
        entity_id=str(guarantee_id),
        after={
            "application_id": str(application_id),
            "guarantor_member_id": str(guarantor_member_id),
            "amount": str(amount),
            "status": "pledged",
        },
    )
    await enqueue_event(
        session,
        tenant_id,
        event_type="guarantee.pledged",
        payload={
            "guarantee_id": str(guarantee_id),
            "application_id": str(application_id),
            "guarantor_member_id": str(guarantor_member_id),
            "amount": str(amount),
        },
    )
    await recompute_cover(session, tenant_id, application_id)
    return GuaranteeRecord(
        id=guarantee_id,
        application_id=application_id,
        guarantor_member_id=guarantor_member_id,
        borrower_member_id=borrower_id,
        amount=amount,
        status="pledged",
        version=1,
    )


async def consent_guarantee(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    guarantee_id: uuid.UUID,
    *,
    version: int,
) -> GuaranteeRecord:
    """Record guarantor consent: pledged -> active (gates 1.4, 1.5)."""
    row = (
        await session.execute(
            text(
                "SELECT application_id, guarantor_member_id, borrower_member_id, "
                "amount, status, version FROM guarantees "
                "WHERE id = CAST(:id AS uuid) "
                "AND tenant_id = CAST(:tid AS uuid) FOR UPDATE"
            ),
            {"id": str(guarantee_id), "tid": str(tenant_id)},
        )
    ).first()
    if row is None:
        raise NotFoundError(f"guarantee {guarantee_id} not found")
    status = str(row[4])
    if status != "pledged":
        raise ConflictError(f"only pledged guarantees can be consented, not '{status}'")
    result = cast(
        CursorResult[Any],
        await session.execute(
            text(
                # Explicit tenant predicate on the write, on top of RLS
                # (defence in depth, gate 1.6).
                "UPDATE guarantees SET status = 'active', "
                "version = version + 1, updated_at = now() "
                "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid) "
                "AND version = :ver"
            ),
            {"id": str(guarantee_id), "tid": str(tenant_id), "ver": version},
        ),
    )
    if result.rowcount != 1:
        raise ConflictError(f"stale version {version} for guarantee {guarantee_id}")
    await record_audit(
        session,
        tenant_id,
        actor_id,
        action="guarantee.consent",
        entity="guarantees",
        entity_id=str(guarantee_id),
        before={"status": "pledged"},
        after={"status": "active"},
    )
    await enqueue_event(
        session,
        tenant_id,
        event_type="guarantee.consented",
        payload={"guarantee_id": str(guarantee_id)},
    )
    return GuaranteeRecord(
        id=guarantee_id,
        application_id=uuid.UUID(str(row[0])),
        guarantor_member_id=uuid.UUID(str(row[1])),
        borrower_member_id=uuid.UUID(str(row[2])),
        amount=Decimal(str(row[3])),
        status="active",
        version=int(row[5]) + 1,
    )


async def release_guarantees_for_loan(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID | None,
    loan_id: uuid.UUID,
) -> int:
    """Release every live guarantee behind a loan (P10 closure hook)."""
    result = cast(
        CursorResult[Any],
        await session.execute(
            text(
                # Explicit tenant predicate on the write, on top of RLS
                # (defence in depth, gate 1.6 — finding 15).
                "UPDATE guarantees SET status = 'released', "
                "version = version + 1, updated_at = now() "
                "WHERE loan_id = CAST(:lid AS uuid) "
                "AND tenant_id = CAST(:tid AS uuid) "
                "AND status IN ('pledged', 'active')"
            ),
            {"lid": str(loan_id), "tid": str(tenant_id)},
        ),
    )
    released = int(result.rowcount or 0)
    if released:
        await record_audit(
            session,
            tenant_id,
            actor_id,
            action="guarantee.release",
            entity="guarantees",
            entity_id=str(loan_id),
            after={"loan_id": str(loan_id), "released": released},
        )
        await enqueue_event(
            session,
            tenant_id,
            event_type="guarantee.released",
            payload={"loan_id": str(loan_id), "released": released},
        )
    return released
