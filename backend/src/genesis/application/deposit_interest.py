"""Quarterly deposit-interest accrual job (P11).

Runs per tenant in bounded id-keyset batches, each batch inside its own
short transaction (gate 1.3). The caller injects a session scope (e.g.
functools.partial(tenant_session, factory, tenant_id)) so this module
stays free of infrastructure imports (P10 arrears precedent).

Idempotent at the database level (gates 1.4, 1.5): exactly one
deposit_interest_accruals row per (tenant, account, period_start),
enforced by a UNIQUE constraint. Re-running a period posts nothing new;
a crash mid-run resumes safely because every processed account already
carries its accrual row. Zero-interest accounts (balances whose
quarterly interest rounds below one cent) claim their row without a
posting, so re-runs skip them too.

Accounts are read FOR UPDATE SKIP LOCKED: the INT- posting and the
balance credit happen under the same deposit-account row lock taken by
withdrawals and guarantee pledges, so interest can never interleave
with a concurrent balance change. A locked account is skipped and
picked up by a re-run, which the UNIQUE row makes safe and cheap.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import UTC, datetime, time
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from genesis.application.audit import record_audit
from genesis.application.ledger import post_deposit_interest
from genesis.domain.deposits import QuarterPeriod, quarterly_interest
from genesis.domain.money import ZERO, to_cents

SessionScope = Callable[[], AbstractAsyncContextManager[AsyncSession]]

#: Accounts accrued per transaction (P10 arrears precedent: short
#: transactions, reasonable round trips).
DEFAULT_BATCH_SIZE = 200


@dataclass(frozen=True)
class InterestRunResult:
    scanned: int
    posted: int
    skipped_existing: int
    total_interest: Decimal
    batches: int


async def _process_batch(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    period: QuarterPeriod,
    annual_rate_pct: Decimal,
    after_id: uuid.UUID | None,
    batch_size: int,
) -> tuple[int, int, int, Decimal, uuid.UUID | None]:
    """Accrue one keyset batch; returns (scanned, posted, skipped, total, last_id).

    The scan walks idx_deposit_accounts_scan (tenant_id, id WHERE
    balance > 0). Interest is computed and posted under the account row
    lock (gate 1.4); the accrual row is inserted for every scanned
    account — including zero-interest ones — so the period can never be
    double-processed.
    """
    clause = "AND d.id > CAST(:after AS uuid) " if after_id is not None else ""
    params: dict[str, object] = {"limit": batch_size}
    if after_id is not None:
        params["after"] = str(after_id)
    rows = (
        await session.execute(
            text(
                # Static fragments chosen in code; all values are bound parameters.
                "SELECT d.id, d.member_id, d.balance FROM deposit_accounts d "  # noqa: S608
                f"WHERE d.balance > 0 {clause}"
                "ORDER BY d.id LIMIT :limit "
                "FOR UPDATE OF d SKIP LOCKED"
            ),
            params,
        )
    ).all()
    posted = 0
    skipped = 0
    total = ZERO
    posted_at = datetime.combine(period.end, time.min, tzinfo=UTC)
    for account_id_raw, member_id_raw, balance_raw in rows:
        account_id = str(account_id_raw)
        exists = (
            await session.execute(
                text(
                    "SELECT 1 FROM deposit_interest_accruals "
                    "WHERE account_id = CAST(:a AS uuid) AND period_start = :ps"
                ),
                {"a": account_id, "ps": period.start},
            )
        ).first()
        if exists is not None:
            skipped += 1  # idempotency: this period is already accrued
            continue
        balance = Decimal(str(balance_raw))
        interest = quarterly_interest(balance, annual_rate_pct)
        txn_id: str | None = None
        if interest > ZERO:
            member_id = uuid.UUID(str(member_id_raw))
            posting = await post_deposit_interest(
                session, tenant_id, member_id, interest, None, occurred_at=posted_at
            )
            txn_id = str(posting.txn_id)
            balance_after = to_cents(balance + interest)
            await session.execute(
                text(
                    "UPDATE deposit_accounts SET balance = :bal, "
                    "version = version + 1, updated_at = now() "
                    "WHERE id = CAST(:id AS uuid)"
                ),
                {"bal": str(balance_after), "id": account_id},
            )
            await record_audit(
                session,
                tenant_id,
                None,
                action="deposit_account.interest",
                entity="deposit_accounts",
                entity_id=account_id,
                before={"balance": str(balance)},
                after={
                    "balance": str(balance_after),
                    "txn_ref": posting.txn_ref,
                    "period_start": period.start.isoformat(),
                },
            )
            posted += 1
            total += interest
        await session.execute(
            text(
                "INSERT INTO deposit_interest_accruals "
                "(id, tenant_id, account_id, period_start, period_end, "
                " annual_rate_pct, amount, transaction_id) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:a AS uuid), "
                ":ps, :pe, :rate, :amount, CAST(:txn AS uuid))"
            ),
            {
                "id": str(uuid.uuid4()),
                "tid": str(tenant_id),
                "a": account_id,
                "ps": period.start,
                "pe": period.end,
                "rate": str(annual_rate_pct),
                "amount": str(interest),
                "txn": txn_id,
            },
        )
    last_id = uuid.UUID(str(rows[-1][0])) if rows else None
    return len(rows), posted, skipped, total, last_id


async def run_deposit_interest_for_tenant(
    session_scope: SessionScope,
    tenant_id: uuid.UUID,
    *,
    period: QuarterPeriod,
    annual_rate_pct: Decimal,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> InterestRunResult:
    """Accrue one completed quarter for every positive-balance account."""
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    # Validate the rate once up front (domain rule), not per account.
    quarterly_interest(ZERO, annual_rate_pct)
    scanned = 0
    posted = 0
    skipped = 0
    total = ZERO
    batches = 0
    after_id: uuid.UUID | None = None
    while True:
        async with session_scope() as session:
            b_scanned, b_posted, b_skipped, b_total, after_id = await _process_batch(
                session,
                tenant_id,
                period=period,
                annual_rate_pct=annual_rate_pct,
                after_id=after_id,
                batch_size=batch_size,
            )
        scanned += b_scanned
        posted += b_posted
        skipped += b_skipped
        total += b_total
        if b_scanned:
            batches += 1
        if b_scanned < batch_size:
            return InterestRunResult(
                scanned=scanned,
                posted=posted,
                skipped_existing=skipped,
                total_interest=total,
                batches=batches,
            )
