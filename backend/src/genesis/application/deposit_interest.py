"""Quarterly deposit-interest accrual job (P11).

Runs per tenant in bounded id-keyset batches through the shared
batch runner (each batch its own short transaction, gate 1.3). The
caller injects a session scope (e.g. functools.partial(tenant_session,
factory, tenant_id)) so this module stays free of infrastructure
imports (P10 arrears precedent).

Interest basis (review finding 1): interest is computed from the
balance **as of the period end**, never from today's balance. The
historical balance is reconstructed authoritatively from the ledger:
every deposit-balance change posts a member.deposits leg through the
P7 contract, so

    balance_at_period_end = current_balance
                            - net(member.deposits legs after the period)

computed under the account row lock. A deposit made after the period
ended earns nothing for that period; an account emptied after the
period ended still earns what its quarter-end balance deserved (which
is why the scan covers every account, not only positive balances).

Rate and period (review finding 2): the annual rate comes exclusively
from tenant_settings, and the accrued period is resolved server-side
by resolve_run_parameters — the earliest quarter not yet fully
accrued, advancing one completed quarter per run, capped at the most
recent completed quarter. Callers can never supply a rate or backdate
an arbitrary period.

Idempotent at the database level (gates 1.4, 1.5): exactly one
deposit_interest_accruals row per (tenant, account, period_start),
claimed with INSERT ... ON CONFLICT DO NOTHING (no race window, no
IntegrityError mid-batch — review finding 4); rowcount 0 means the
period is already accrued and the account is skipped. A skipped row
whose stored rate differs from the configured rate is surfaced as
rate_mismatches with a warning log, without breaking idempotency
(review finding 13). Zero-interest accounts claim their row without a
posting, so re-runs skip them too.

Accounts are read FOR UPDATE SKIP LOCKED: the INT- posting and the
balance credit happen under the same deposit-account row lock taken by
withdrawals and guarantee pledges, so interest can never interleave
with a concurrent balance change. A locked account is skipped and
picked up by a re-run, which the UNIQUE row makes safe and cheap.

The INT- posting carries occurred_at = 23:59:59.999999 UTC on the last
day of the period (review finding 5): interest is recognised at the
very end of the period it was earned in, so it sorts after that day's
real transactions in the ledger listing and is included in the next
quarter's reconstructed balance (interest compounds from the moment it
is credited).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from functools import partial
from typing import Any, cast

from sqlalchemy import CursorResult, text
from sqlalchemy.ext.asyncio import AsyncSession

from genesis.application.audit import record_audit
from genesis.application.batch_runner import SessionScope, run_in_batches
from genesis.application.ledger import post_deposit_interest
from genesis.domain.deposits import (
    QuarterPeriod,
    next_quarter,
    previous_quarter,
    quarter_of,
    quarterly_interest,
)
from genesis.domain.ledger import Account
from genesis.domain.money import ZERO, to_cents
from genesis.errors import ConflictError, InvalidInputError

logger = logging.getLogger(__name__)

#: Accounts accrued per transaction (P10 arrears precedent: short
#: transactions, reasonable round trips).
DEFAULT_BATCH_SIZE = 200


@dataclass(frozen=True)
class InterestRunResult:
    scanned: int
    posted: int
    skipped_existing: int
    rate_mismatches: int
    total_interest: Decimal
    batches: int


async def resolve_run_parameters(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    today: date | None = None,
) -> tuple[QuarterPeriod, Decimal]:
    """Resolve the (period, annual rate) the accrual job must run with.

    The rate comes exclusively from tenant_settings (gate 1.6: never
    caller-supplied). The period is the earliest quarter not yet fully
    accrued, in strict order, capped at the most recent completed
    quarter:

      * no accruals yet            -> the last completed quarter
      * latest accrued period has
        accounts without a row     -> that period again (finish it —
                                      crash recovery, new accounts)
      * latest period fully
        claimed and older than the
        last completed quarter     -> the next quarter in sequence
      * fully caught up            -> the last completed quarter again
                                      (idempotent no-op re-run)

    Tenants behind by several quarters catch up one period per run, in
    order — arbitrary historical periods can never be requested.
    """
    as_of = today or datetime.now(UTC).date()
    rate_row = (
        await session.execute(
            text(
                # Explicit tenant predicate on top of RLS (defence in
                # depth, gate 1.6) — money-path configuration read.
                "SELECT deposit_interest_annual_rate_pct FROM tenant_settings "
                "WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": str(tenant_id)},
        )
    ).first()
    if rate_row is None:
        raise ConflictError(
            "deposit interest is not configured for this tenant "
            "(tenant_settings.deposit_interest_annual_rate_pct)"
        )
    rate = Decimal(str(rate_row[0]))

    most_recent = previous_quarter(as_of)
    latest_start = (
        await session.execute(
            text(
                "SELECT MAX(period_start) FROM deposit_interest_accruals "
                "WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": str(tenant_id)},
        )
    ).scalar_one()
    if latest_start is None:
        return most_recent, rate
    latest = quarter_of(latest_start)
    if latest.start >= most_recent.start:
        return most_recent, rate
    pending = (
        await session.execute(
            text(
                "SELECT 1 FROM deposit_accounts d "
                "WHERE d.tenant_id = CAST(:tid AS uuid) AND NOT EXISTS ("
                "  SELECT 1 FROM deposit_interest_accruals a "
                "  WHERE a.tenant_id = d.tenant_id AND a.account_id = d.id "
                "  AND a.period_start = :ps"
                ") LIMIT 1"
            ),
            {"tid": str(tenant_id), "ps": latest.start},
        )
    ).first()
    if pending is not None:
        return latest, rate
    return next_quarter(latest), rate


async def _balance_as_of_period_end(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    member_id: uuid.UUID,
    *,
    current_balance: Decimal,
    cutoff: datetime,
) -> Decimal:
    """Reconstruct the deposit balance at the period end from the ledger.

    Every deposit-balance writer posts a member.deposits leg through
    the P7 contract in the same transaction as the balance update, so
    subtracting the net movement at/after the cutoff from the current
    balance (both read under the account row lock) yields the balance
    the account held when the period closed. Clamped at zero as a
    guard for directly seeded fixtures without ledger history.
    """
    delta = (
        await session.execute(
            text(
                "SELECT COALESCE(SUM(CASE WHEN le.side = 'credit' "
                "THEN le.amount ELSE -le.amount END), 0) "
                "FROM ledger_entries le "
                "JOIN transactions t ON t.id = le.transaction_id "
                "AND t.tenant_id = le.tenant_id "
                "WHERE le.tenant_id = CAST(:tid AS uuid) "
                "AND t.member_id = CAST(:m AS uuid) "
                "AND le.account = :acct AND t.occurred_at >= :cutoff"
            ),
            {
                "tid": str(tenant_id),
                "m": str(member_id),
                "acct": Account.MEMBER_DEPOSITS.value,
                "cutoff": cutoff,
            },
        )
    ).scalar_one()
    historical = to_cents(current_balance - Decimal(str(delta)))
    return historical if historical > ZERO else ZERO


async def _process_batch(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    period: QuarterPeriod,
    annual_rate_pct: Decimal,
    after_id: uuid.UUID | None,
    batch_size: int,
) -> tuple[int, uuid.UUID | None, tuple[int, int, int, Decimal]]:
    """Accrue one keyset batch; returns (scanned, last_id, (posted, skipped, mismatches, total)).

    The scan walks idx_deposit_accounts_keyset (tenant_id, id) over
    *every* account: an account emptied after the period end still
    earned interest on its quarter-end balance. Interest is computed
    and posted under the account row lock (gate 1.4); the accrual row
    is claimed with ON CONFLICT DO NOTHING for every scanned account —
    including zero-interest ones — so the period can never be
    double-processed.
    """
    clause = "AND d.id > CAST(:after AS uuid) " if after_id is not None else ""
    params: dict[str, object] = {"tid": str(tenant_id), "limit": batch_size}
    if after_id is not None:
        params["after"] = str(after_id)
    rows = (
        await session.execute(
            text(
                # Static fragments chosen in code; all values are bound parameters.
                "SELECT d.id, d.member_id, d.balance FROM deposit_accounts d "  # noqa: S608
                f"WHERE d.tenant_id = CAST(:tid AS uuid) {clause}"
                "ORDER BY d.id LIMIT :limit "
                "FOR UPDATE OF d SKIP LOCKED"
            ),
            params,
        )
    ).all()
    posted = 0
    skipped = 0
    mismatches = 0
    total = ZERO
    # Interest belongs to the very end of the period it was earned in
    # (review finding 5): 23:59:59.999999 UTC on the period's last day
    # sorts after that day's real transactions and inside the period.
    posted_at = datetime.combine(period.end, time.max, tzinfo=UTC)
    # Ledger movements at/after the first instant of the following day
    # happened after the period and are excluded from the basis.
    cutoff = datetime.combine(period.end + timedelta(days=1), time.min, tzinfo=UTC)
    for account_id_raw, member_id_raw, balance_raw in rows:
        account_id = str(account_id_raw)
        member_id = uuid.UUID(str(member_id_raw))
        balance = Decimal(str(balance_raw))
        basis = await _balance_as_of_period_end(
            session, tenant_id, member_id, current_balance=balance, cutoff=cutoff
        )
        interest = quarterly_interest(basis, annual_rate_pct)
        accrual_id = str(uuid.uuid4())
        claim = cast(
            CursorResult[Any],
            await session.execute(
                text(
                    # Single atomic claim on the UNIQUE idempotency key
                    # (tenant_id, account_id, period_start): rowcount 0
                    # means already accrued — no SELECT-then-INSERT race,
                    # no IntegrityError mid-batch (review finding 4).
                    "INSERT INTO deposit_interest_accruals "
                    "(id, tenant_id, account_id, period_start, period_end, "
                    " annual_rate_pct, amount) "
                    "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:a AS uuid), "
                    ":ps, :pe, :rate, :amount) "
                    "ON CONFLICT (tenant_id, account_id, period_start) DO NOTHING"
                ),
                {
                    "id": accrual_id,
                    "tid": str(tenant_id),
                    "a": account_id,
                    "ps": period.start,
                    "pe": period.end,
                    "rate": str(annual_rate_pct),
                    "amount": str(interest),
                },
            ),
        )
        if claim.rowcount == 0:
            skipped += 1  # idempotency: this period is already accrued
            stored_rate = (
                await session.execute(
                    text(
                        "SELECT annual_rate_pct FROM deposit_interest_accruals "
                        "WHERE tenant_id = CAST(:tid AS uuid) "
                        "AND account_id = CAST(:a AS uuid) AND period_start = :ps"
                    ),
                    {"tid": str(tenant_id), "a": account_id, "ps": period.start},
                )
            ).scalar_one()
            if Decimal(str(stored_rate)) != annual_rate_pct:
                # Already accrued at a different rate: never re-posted
                # (idempotency wins), but surfaced instead of silently
                # conflated with a plain skip (review finding 13).
                mismatches += 1
                logger.warning(
                    "deposit interest accrual rate mismatch: tenant=%s account=%s "
                    "period_start=%s stored_rate=%s configured_rate=%s",
                    tenant_id,
                    account_id,
                    period.start,
                    stored_rate,
                    annual_rate_pct,
                )
            continue
        if interest > ZERO:
            posting = await post_deposit_interest(
                session, tenant_id, member_id, interest, None, occurred_at=posted_at
            )
            balance_after = to_cents(balance + interest)
            await session.execute(
                text(
                    "UPDATE deposit_accounts SET balance = :bal, "
                    "version = version + 1, updated_at = now() "
                    "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
                ),
                {"bal": str(balance_after), "id": account_id, "tid": str(tenant_id)},
            )
            await session.execute(
                text(
                    "UPDATE deposit_interest_accruals SET transaction_id = CAST(:txn AS uuid) "
                    "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
                ),
                {"txn": str(posting.txn_id), "id": accrual_id, "tid": str(tenant_id)},
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
                    "basis": str(basis),
                    "txn_ref": posting.txn_ref,
                    "period_start": period.start.isoformat(),
                },
            )
            posted += 1
            total += interest
    last_id = uuid.UUID(str(rows[-1][0])) if rows else None
    return len(rows), last_id, (posted, skipped, mismatches, total)


async def run_deposit_interest_for_tenant(
    session_scope: SessionScope,
    tenant_id: uuid.UUID,
    *,
    period: QuarterPeriod,
    annual_rate_pct: Decimal,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> InterestRunResult:
    """Accrue one completed quarter for every deposit account.

    period and annual_rate_pct must come from resolve_run_parameters
    (tenant configuration + strict period ordering) — the API never
    forwards caller-supplied values.
    """
    # Validate the rate once up front (domain rule), not per account,
    # translated into the shared error taxonomy so non-API callers get
    # a mapped 4xx instead of an unhandled ValueError (gate 1.2).
    try:
        quarterly_interest(ZERO, annual_rate_pct)
    except ValueError as exc:
        raise InvalidInputError(str(exc)) from exc
    process = partial(
        _process_one,
        tenant_id=tenant_id,
        period=period,
        annual_rate_pct=annual_rate_pct,
        batch_size=batch_size,
    )
    scanned, batches, payloads = await run_in_batches(session_scope, process, batch_size=batch_size)
    posted = sum(p[0] for p in payloads)
    skipped = sum(p[1] for p in payloads)
    mismatches = sum(p[2] for p in payloads)
    total = sum((p[3] for p in payloads), ZERO)
    return InterestRunResult(
        scanned=scanned,
        posted=posted,
        skipped_existing=skipped,
        rate_mismatches=mismatches,
        total_interest=total,
        batches=batches,
    )


async def _process_one(
    session: AsyncSession,
    after_id: uuid.UUID | None,
    *,
    tenant_id: uuid.UUID,
    period: QuarterPeriod,
    annual_rate_pct: Decimal,
    batch_size: int,
) -> tuple[int, uuid.UUID | None, tuple[int, int, int, Decimal]]:
    """Adapter matching the shared BatchProcessor signature."""
    return await _process_batch(
        session,
        tenant_id,
        period=period,
        annual_rate_pct=annual_rate_pct,
        after_id=after_id,
        batch_size=batch_size,
    )
