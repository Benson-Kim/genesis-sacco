"""Integration tests for P11 transactions & deposit interest (real Postgres, RLS)."""

import asyncio
import os
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from functools import partial

import pytest
from sqlalchemy import text

from db_helpers import factory, seed_user, unique_email
from genesis.application import deposit_interest as interest_service
from genesis.application import transactions as txn_service
from genesis.domain.deposits import previous_quarter
from genesis.domain.ledger import Channel, Side, TxnType
from genesis.errors import ConflictError
from genesis.infrastructure.tenancy import tenant_session

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)


async def _seed_member(
    tid: uuid.UUID, *, deposit: str = "0", shares: str = "0", status: str = "active"
) -> uuid.UUID:
    mid = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO members (id, tenant_id, member_no, type, name, status) VALUES "
                "(CAST(:id AS uuid), CAST(:tid AS uuid), :no, 'person', 'Txn Member', :status)"
            ),
            {"id": str(mid), "tid": str(tid), "no": f"GP-{mid.hex[:6].upper()}", "status": status},
        )
        await session.execute(
            text(
                "INSERT INTO deposit_accounts (id, tenant_id, member_id, balance) VALUES "
                "(CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:m AS uuid), :bal)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tid), "m": str(mid), "bal": deposit},
        )
        await session.execute(
            text(
                "INSERT INTO share_accounts (id, tenant_id, member_id, balance) VALUES "
                "(CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:m AS uuid), :bal)"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tid), "m": str(mid), "bal": shares},
        )
    return mid


async def _balance(tid: uuid.UUID, mid: uuid.UUID, table: str = "deposit_accounts") -> Decimal:
    async with tenant_session(factory(), tid) as session:
        val = (
            await session.execute(
                # Table name from test code, never user input.
                text(f"SELECT balance FROM {table} WHERE member_id = CAST(:m AS uuid)"),  # noqa: S608
                {"m": str(mid)},
            )
        ).scalar_one()
    return Decimal(str(val))


async def _interest_counts(tid: uuid.UUID) -> tuple[int, int, int, int]:
    """Side-effect counts proving idempotency: (txns, audits, outbox, accruals)."""
    async with tenant_session(factory(), tid) as session:
        txns = (
            await session.execute(
                text("SELECT count(*) FROM transactions WHERE type = 'interest_posting'")
            )
        ).scalar_one()
        audits = (
            await session.execute(
                text("SELECT count(*) FROM audit_log WHERE action = 'deposit_account.interest'")
            )
        ).scalar_one()
        events = (
            await session.execute(
                text(
                    "SELECT count(*) FROM outbox_events "
                    "WHERE event_type = 'ledger.deposit_interest_posted'"
                )
            )
        ).scalar_one()
        accruals = (
            await session.execute(text("SELECT count(*) FROM deposit_interest_accruals"))
        ).scalar_one()
    return int(txns), int(audits), int(events), int(accruals)


def test_deposit_credits_account_posts_ledger_audit_outbox() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)
        async with tenant_session(factory(), tid) as session:
            result = await txn_service.record_deposit(
                session, tid, None, mid, amount=Decimal("500.00"), channel=Channel.MPESA
            )
        assert result.txn_ref.startswith("MP-")
        assert result.balance_after == Decimal("500.00")
        assert await _balance(tid, mid) == Decimal("500.00")
        async with tenant_session(factory(), tid) as session:
            sides = (
                await session.execute(
                    text("SELECT side, COALESCE(SUM(amount), 0) FROM ledger_entries GROUP BY side")
                )
            ).all()
            audit = (
                await session.execute(
                    text("SELECT count(*) FROM audit_log WHERE action = 'deposit_account.credit'")
                )
            ).scalar_one()
            events = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM outbox_events "
                        "WHERE event_type = 'ledger.deposit_posted'"
                    )
                )
            ).scalar_one()
        totals = {str(r[0]): Decimal(str(r[1])) for r in sides}
        assert totals["debit"] == totals["credit"] == Decimal("500.00")
        assert int(audit) == 1
        assert int(events) == 1

    asyncio.run(run())


def test_share_topup_credits_share_account() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)
        async with tenant_session(factory(), tid) as session:
            result = await txn_service.record_share_topup(
                session, tid, None, mid, amount=Decimal("250.00"), channel=Channel.BANK
            )
        assert result.txn_ref.startswith("SH-")
        assert await _balance(tid, mid, table="share_accounts") == Decimal("250.00")
        assert await _balance(tid, mid) == Decimal("0.00")  # deposit account untouched

    asyncio.run(run())


def test_concurrent_withdrawals_never_overdraw() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid, deposit="5000.00")

        async def withdraw() -> bool:
            try:
                async with tenant_session(factory(), tid) as session:
                    await txn_service.record_withdrawal(
                        session, tid, None, mid, amount=Decimal("1000.00"), channel=Channel.BANK
                    )
            except ConflictError:
                return False
            return True

        results = await asyncio.gather(*(withdraw() for _ in range(10)))
        assert sum(results) == 5  # exactly the affordable withdrawals land
        assert await _balance(tid, mid) == Decimal("0.00")
        async with tenant_session(factory(), tid) as session:
            refs = (
                (
                    await session.execute(
                        text("SELECT txn_ref FROM transactions WHERE type = 'withdrawal'")
                    )
                )
                .scalars()
                .all()
            )
        assert len(refs) == 5
        assert len(set(refs)) == 5  # race-safe WD- refs, no duplicates

    asyncio.run(run())


def test_withdrawal_respects_live_pledges_and_blocks_exited_members() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        guarantor = await _seed_member(tid, deposit="1000.00")
        borrower = await _seed_member(tid)
        async with tenant_session(factory(), tid) as session:
            await session.execute(
                text(
                    "INSERT INTO guarantees "
                    "(id, tenant_id, guarantor_member_id, borrower_member_id, amount) "
                    "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:g AS uuid), "
                    "CAST(:b AS uuid), :amount)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tid": str(tid),
                    "g": str(guarantor),
                    "b": str(borrower),
                    "amount": "600.00",
                },
            )
        # 1000 balance - 600 pledged = 400 withdrawable: 500 must fail.
        with pytest.raises(ConflictError, match="insufficient available funds"):
            async with tenant_session(factory(), tid) as session:
                await txn_service.record_withdrawal(
                    session, tid, None, guarantor, amount=Decimal("500.00"), channel=Channel.BANK
                )
        async with tenant_session(factory(), tid) as session:
            ok = await txn_service.record_withdrawal(
                session, tid, None, guarantor, amount=Decimal("400.00"), channel=Channel.BANK
            )
        assert ok.txn_ref.startswith("WD-")
        assert await _balance(tid, guarantor) == Decimal("600.00")

        exited = await _seed_member(tid, deposit="100.00", status="exited")
        with pytest.raises(ConflictError, match="exited"):
            async with tenant_session(factory(), tid) as session:
                await txn_service.record_deposit(
                    session, tid, None, exited, amount=Decimal("10.00"), channel=Channel.MPESA
                )

    asyncio.run(run())


def test_interest_job_posts_once_and_rerun_changes_nothing() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        m1 = await _seed_member(tid, deposit="10000.00")
        m2 = await _seed_member(tid, deposit="0.01")  # interest rounds below one cent
        await _seed_member(tid, deposit="0.00")  # zero balance: never scanned
        period = previous_quarter(datetime.now(UTC).date())
        scope = partial(tenant_session, factory(), tid)

        first = await interest_service.run_deposit_interest_for_tenant(
            scope, tid, period=period, annual_rate_pct=Decimal("8.00"), batch_size=1
        )
        assert first.scanned == 2
        assert first.posted == 1
        assert first.skipped_existing == 0
        assert first.total_interest == Decimal("200.00")  # hand-computed oracle
        assert first.batches == 2  # batch_size=1 proves the batching path
        assert await _balance(tid, m1) == Decimal("10200.00")
        assert await _balance(tid, m2) == Decimal("0.01")
        before = await _interest_counts(tid)

        second = await interest_service.run_deposit_interest_for_tenant(
            scope, tid, period=period, annual_rate_pct=Decimal("8.00"), batch_size=1
        )
        assert second.posted == 0
        assert second.skipped_existing == 2
        assert second.total_interest == Decimal("0.00")
        # Idempotency proven by side effects: ledger, audit, outbox and
        # accrual-row counts are all unchanged, as are the balances.
        assert await _interest_counts(tid) == before
        assert await _balance(tid, m1) == Decimal("10200.00")

    asyncio.run(run())


def test_ledger_listing_keyset_filters_and_tenant_isolation() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid, deposit="1000.00")
        for amt in ("100.00", "200.00", "300.00"):
            async with tenant_session(factory(), tid) as session:
                await txn_service.record_deposit(
                    session, tid, None, mid, amount=Decimal(amt), channel=Channel.BANK
                )
        async with tenant_session(factory(), tid) as session:
            await txn_service.record_withdrawal(
                session, tid, None, mid, amount=Decimal("50.00"), channel=Channel.BANK
            )

        async with tenant_session(factory(), tid) as session:
            page1, cursor = await txn_service.list_transactions(session, limit=2)
            assert len(page1) == 2
            assert cursor is not None
            assert page1[0].txn_type is TxnType.WITHDRAWAL  # newest first
            assert page1[0].direction is Side.DEBIT
            page2, cursor2 = await txn_service.list_transactions(session, cursor=cursor, limit=2)
            assert len(page2) == 2
            assert cursor2 is None
            ids = {t.id for t in page1} | {t.id for t in page2}
            assert len(ids) == 4  # keyset pages never overlap

            deposits, _ = await txn_service.list_transactions(session, txn_type=TxnType.DEPOSIT)
            assert len(deposits) == 3
            assert all(t.direction is Side.CREDIT for t in deposits)
            debits, _ = await txn_service.list_transactions(session, direction=Side.DEBIT)
            assert [t.txn_type for t in debits] == [TxnType.WITHDRAWAL]
            by_ref, _ = await txn_service.list_transactions(session, ref=page1[0].txn_ref)
            assert len(by_ref) == 1

        other_tid, _ = await seed_user(unique_email())
        async with tenant_session(factory(), other_tid) as session:
            foreign, _ = await txn_service.list_transactions(session)
        assert foreign == []  # RLS: zero rows cross-tenant

    asyncio.run(run())
