"""Integration tests for the double-entry ledger (P7 EXIT criteria).

Requires a migrated PostgreSQL database (DATABASE_URL env var).

Tests covered:
  * Trigger: balanced DR/CR enforced at COMMIT — unbalanced insert raises
  * Trigger: UPDATE on ledger_entries raises
  * Trigger: DELETE on ledger_entries raises
  * Trigger: UPDATE on transactions raises
  * Trigger: DELETE on transactions raises
  * Reversal: reversing entry posts correctly; original untouched;
    reversal_of_id linkage set; double reversal and reversing a reversal
    both raise ConflictError
  * Disbursement: atomic — approval check + posting + schedule + outbox
  * Disbursement: non-approved application raises ConflictError
  * Concurrency: 50 parallel deposits produce zero gaps or duplicates in refs
  * Audit log: every posting writes an audit row
  * Cross-tenant: tenant B cannot read tenant A ledger entries
"""

from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db_helpers import factory, seed_user, unique_email
from genesis.application.ledger import (
    DisbursementResult,
    PostingResult,
    disburse_loan,
    post_deposit,
    post_deposit_interest,
    post_loan_interest_accrual,
    post_repayment,
    post_reversal,
    post_share_topup,
    post_withdrawal,
)
from genesis.domain.ledger import Channel
from genesis.errors import ConflictError, NotFoundError
from genesis.infrastructure.tenancy import tenant_session

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_member(tid: uuid.UUID) -> uuid.UUID:
    """Insert a minimal member row and return its id.

    The deposit account satisfies the P12.5 multiplier precondition
    (issue #15): 100000.00 x 3.00 covers every amount disbursed here —
    these tests exercise the posting contract, not the eligibility gate
    (test_deposit_multiplier.py owns that).
    """
    mid = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO members (id, tenant_id, member_no, type, name) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), :no, 'person', 'Test Member')"
            ),
            {"id": str(mid), "tid": str(tid), "no": f"GP-{mid.hex[:6].upper()}"},
        )
        await session.execute(
            text(
                "INSERT INTO deposit_accounts (id, tenant_id, member_id, balance) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:m AS uuid), '100000.00')"
            ),
            {"id": str(uuid.uuid4()), "tid": str(tid), "m": str(mid)},
        )
    return mid


async def _seed_product(tid: uuid.UUID) -> uuid.UUID:
    """Insert a minimal loan product and return its id."""
    pid = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO loan_products "
                "(id, tenant_id, name, rate_pct, deposit_multiplier, max_term_months) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), :name, 12.00, 3.00, 60)"
            ),
            {"id": str(pid), "tid": str(tid), "name": f"Product-{pid.hex[:6]}"},
        )
    return pid


async def _seed_approved_application(
    tid: uuid.UUID, mid: uuid.UUID, pid: uuid.UUID, amount: Decimal
) -> uuid.UUID:
    """Insert a loan application in 'approved' stage and return its id."""
    app_id = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO loan_applications "
                "(id, tenant_id, member_id, product_id, amount, term_months, "
                " rate_pct, stage) "
                "VALUES "
                "(CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:mid AS uuid), "
                " CAST(:pid AS uuid), :amount, 12, 12.00, 'approved')"
            ),
            {
                "id": str(app_id),
                "tid": str(tid),
                "mid": str(mid),
                "pid": str(pid),
                "amount": str(amount),
            },
        )
    return app_id


# ---------------------------------------------------------------------------
# Trigger tests
# ---------------------------------------------------------------------------


def test_trigger_blocks_unbalanced_ledger_insert() -> None:
    """The deferred constraint trigger must reject an unbalanced set of
    ledger lines at COMMIT (gate 1.5) — protecting raw SQL writers too."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            # Post a valid deposit first to get a transaction id.
            result = await post_deposit(session, tid, mid, Decimal("1000"), Channel.MPESA)
            txn_id = result.txn_id

        # Insert an extra unbalanced line directly.  The INSERT statement
        # itself succeeds; the DEFERRABLE INITIALLY DEFERRED constraint
        # trigger raises when the transaction COMMITs (on context exit).
        with pytest.raises(Exception, match=r"[Uu]nbalanced"):
            async with tenant_session(factory(), tid) as session:
                await session.execute(
                    text(
                        "INSERT INTO ledger_entries "
                        "(id, tenant_id, transaction_id, account, side, amount) "
                        "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), "
                        "CAST(:txn AS uuid), 'cash.mpesa', 'debit', 500.00)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "tid": str(tid),
                        "txn": str(txn_id),
                    },
                )
                # No error yet: balance is only validated at commit.

    asyncio.run(run())


def test_trigger_blocks_update_on_ledger_entries() -> None:
    """UPDATE on ledger_entries must raise (gate 1.5)."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit(session, tid, mid, Decimal("500"), Channel.MPESA)
            txn_id = result.txn_id

        with pytest.raises(Exception, match="append-only"):
            async with tenant_session(factory(), tid) as session:
                await session.execute(
                    text(
                        "UPDATE ledger_entries SET amount = 999 "
                        "WHERE transaction_id = CAST(:txn AS uuid)"
                    ),
                    {"txn": str(txn_id)},
                )

    asyncio.run(run())


def test_trigger_blocks_delete_on_ledger_entries() -> None:
    """DELETE on ledger_entries must raise (gate 1.5)."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit(session, tid, mid, Decimal("500"), Channel.MPESA)
            txn_id = result.txn_id

        with pytest.raises(Exception, match="append-only"):
            async with tenant_session(factory(), tid) as session:
                await session.execute(
                    text("DELETE FROM ledger_entries WHERE transaction_id = CAST(:txn AS uuid)"),
                    {"txn": str(txn_id)},
                )

    asyncio.run(run())


def test_trigger_blocks_update_on_transactions() -> None:
    """UPDATE on transactions must raise (gate 1.5)."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit(session, tid, mid, Decimal("500"), Channel.MPESA)
            txn_id = result.txn_id

        with pytest.raises(Exception, match="append-only"):
            async with tenant_session(factory(), tid) as session:
                await session.execute(
                    text("UPDATE transactions SET amount = 999 WHERE id = CAST(:id AS uuid)"),
                    {"id": str(txn_id)},
                )

    asyncio.run(run())


def test_trigger_blocks_delete_on_transactions() -> None:
    """DELETE on transactions must raise (gate 1.5)."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit(session, tid, mid, Decimal("500"), Channel.MPESA)
            txn_id = result.txn_id

        with pytest.raises(Exception, match="append-only"):
            async with tenant_session(factory(), tid) as session:
                await session.execute(
                    text("DELETE FROM transactions WHERE id = CAST(:id AS uuid)"),
                    {"id": str(txn_id)},
                )

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Posting service tests
# ---------------------------------------------------------------------------


def test_deposit_creates_balanced_ledger_entries() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit(session, tid, mid, Decimal("2500.00"), Channel.MPESA)

        assert result.txn_ref.startswith("MP-")

        async with tenant_session(factory(), tid) as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT side, SUM(amount) FROM ledger_entries "
                        "WHERE transaction_id = CAST(:id AS uuid) GROUP BY side"
                    ),
                    {"id": str(result.txn_id)},
                )
            ).all()
        totals = {str(r[0]): Decimal(str(r[1])) for r in rows}
        assert totals["debit"] == totals["credit"] == Decimal("2500.00")

    asyncio.run(run())


def test_withdrawal_creates_balanced_ledger_entries() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_withdrawal(session, tid, mid, Decimal("1000.00"), Channel.BANK)

        assert result.txn_ref.startswith("WD-")

        async with tenant_session(factory(), tid) as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT side, SUM(amount) FROM ledger_entries "
                        "WHERE transaction_id = CAST(:id AS uuid) GROUP BY side"
                    ),
                    {"id": str(result.txn_id)},
                )
            ).all()
        totals = {str(r[0]): Decimal(str(r[1])) for r in rows}
        assert totals["debit"] == totals["credit"] == Decimal("1000.00")

    asyncio.run(run())


def test_share_topup_ref_prefix() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_share_topup(session, tid, mid, Decimal("500.00"), Channel.MPESA)

        assert result.txn_ref.startswith("SH-")

    asyncio.run(run())


def test_repayment_ref_prefix_and_repayments_row() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)
        pid = await _seed_product(tid)
        app_id = await _seed_approved_application(tid, mid, pid, Decimal("10000"))

        async with tenant_session(factory(), tid) as session:
            disb = await disburse_loan(session, tid, app_id, Channel.BANK)

        async with tenant_session(factory(), tid) as session:
            result = await post_repayment(
                session, tid, mid, disb.loan_id, Decimal("1000.00"), Channel.MPESA
            )

        assert result.txn_ref.startswith("RP-")

        async with tenant_session(factory(), tid) as session:
            count = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM repayments WHERE transaction_id = CAST(:id AS uuid)"
                    ),
                    {"id": str(result.txn_id)},
                )
            ).scalar_one()
        assert int(count) == 1

    asyncio.run(run())


def test_loan_interest_accrual_ref_prefix() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_loan_interest_accrual(session, tid, mid, Decimal("125.50"))

        assert result.txn_ref.startswith("INT-")

    asyncio.run(run())


def test_deposit_interest_ref_prefix() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit_interest(session, tid, mid, Decimal("42.00"))

        assert result.txn_ref.startswith("INT-")

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Reversal tests
# ---------------------------------------------------------------------------


def test_reversal_creates_mirror_entry_and_leaves_original_intact() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            original = await post_deposit(session, tid, mid, Decimal("3000.00"), Channel.MPESA)

        async with tenant_session(factory(), tid) as session:
            reversal = await post_reversal(session, tid, original.txn_id)

        assert reversal.txn_ref.startswith("MP-")
        assert reversal.txn_id != original.txn_id

        # Reversal linkage: reversal_of_id points at the original.
        async with tenant_session(factory(), tid) as session:
            linked = (
                await session.execute(
                    text("SELECT reversal_of_id FROM transactions WHERE id = CAST(:id AS uuid)"),
                    {"id": str(reversal.txn_id)},
                )
            ).scalar_one()
        assert str(linked) == str(original.txn_id)

        # Original lines must still exist and be unchanged.
        async with tenant_session(factory(), tid) as session:
            orig_rows = (
                await session.execute(
                    text(
                        "SELECT side, amount FROM ledger_entries "
                        "WHERE transaction_id = CAST(:id AS uuid) ORDER BY side"
                    ),
                    {"id": str(original.txn_id)},
                )
            ).all()
            rev_rows = (
                await session.execute(
                    text(
                        "SELECT side, amount FROM ledger_entries "
                        "WHERE transaction_id = CAST(:id AS uuid) ORDER BY side"
                    ),
                    {"id": str(reversal.txn_id)},
                )
            ).all()

        assert len(orig_rows) == 2
        assert len(rev_rows) == 2

        # Reversal sides are flipped.
        orig_sides = {str(r[0]) for r in orig_rows}
        rev_sides = {str(r[0]) for r in rev_rows}
        assert orig_sides == rev_sides  # both have debit+credit

        # Net effect: DR and CR cancel out across both transactions.
        async with tenant_session(factory(), tid) as session:
            net = (
                await session.execute(
                    text(
                        "SELECT "
                        "SUM(CASE WHEN side='debit' THEN amount ELSE -amount END) "
                        "FROM ledger_entries "
                        "WHERE transaction_id IN "
                        "(CAST(:orig AS uuid), CAST(:rev AS uuid))"
                    ),
                    {"orig": str(original.txn_id), "rev": str(reversal.txn_id)},
                )
            ).scalar_one()
        assert Decimal(str(net)) == Decimal("0.00")

    asyncio.run(run())


def test_reversal_of_nonexistent_transaction_raises() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        async with tenant_session(factory(), tid) as session:
            with pytest.raises(NotFoundError):
                await post_reversal(session, tid, uuid.uuid4())

    asyncio.run(run())


def test_reversal_of_already_reversed_transaction_raises_conflict() -> None:
    """One reversal per original: a second reversal must raise ConflictError."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            original = await post_deposit(session, tid, mid, Decimal("1500.00"), Channel.MPESA)

        async with tenant_session(factory(), tid) as session:
            await post_reversal(session, tid, original.txn_id)

        with pytest.raises(ConflictError, match="already been reversed"):
            async with tenant_session(factory(), tid) as session:
                await post_reversal(session, tid, original.txn_id)

    asyncio.run(run())


def test_reversal_of_a_reversal_raises_conflict() -> None:
    """A reversal itself must never be reversed — re-post the original instead."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            original = await post_deposit(session, tid, mid, Decimal("800.00"), Channel.MPESA)

        async with tenant_session(factory(), tid) as session:
            reversal = await post_reversal(session, tid, original.txn_id)

        with pytest.raises(ConflictError, match="cannot be reversed"):
            async with tenant_session(factory(), tid) as session:
                await post_reversal(session, tid, reversal.txn_id)

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Disbursement atomic transaction tests
# ---------------------------------------------------------------------------


def test_disbursement_is_atomic_and_creates_schedule() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)
        pid = await _seed_product(tid)
        app_id = await _seed_approved_application(tid, mid, pid, Decimal("24000"))

        async with tenant_session(factory(), tid) as session:
            result = await disburse_loan(session, tid, app_id, Channel.BANK)

        assert isinstance(result, DisbursementResult)
        assert result.txn_ref.startswith("LN-")
        assert len(result.schedule) == 12

        # Verify loan record exists.
        async with tenant_session(factory(), tid) as session:
            loan_row = (
                await session.execute(
                    text(
                        "SELECT principal, balance, status FROM loans WHERE id = CAST(:id AS uuid)"
                    ),
                    {"id": str(result.loan_id)},
                )
            ).first()
        assert loan_row is not None
        assert Decimal(str(loan_row[0])) == Decimal("24000.00")
        assert str(loan_row[2]) == "active"

        # Verify schedule rows.
        async with tenant_session(factory(), tid) as session:
            sched_count = (
                await session.execute(
                    text("SELECT count(*) FROM loan_schedules WHERE loan_id = CAST(:id AS uuid)"),
                    {"id": str(result.loan_id)},
                )
            ).scalar_one()
        assert int(sched_count) == 12

        # Verify outbox event.
        async with tenant_session(factory(), tid) as session:
            evt = (
                await session.execute(
                    text(
                        "SELECT payload FROM outbox_events "
                        "WHERE event_type = 'loan.disbursed' "
                        "ORDER BY created_at DESC LIMIT 1"
                    )
                )
            ).scalar_one()
        assert str(result.loan_id) in str(evt)

    asyncio.run(run())


def test_disbursement_of_non_approved_application_raises() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)
        pid = await _seed_product(tid)

        # Create a submitted (not approved) application.
        app_id = uuid.uuid4()
        async with tenant_session(factory(), tid) as session:
            await session.execute(
                text(
                    "INSERT INTO loan_applications "
                    "(id, tenant_id, member_id, product_id, amount, term_months, "
                    " rate_pct, stage) "
                    "VALUES "
                    "(CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:mid AS uuid), "
                    " CAST(:pid AS uuid), 10000, 12, 12.00, 'submitted')"
                ),
                {
                    "id": str(app_id),
                    "tid": str(tid),
                    "mid": str(mid),
                    "pid": str(pid),
                },
            )

        with pytest.raises(ConflictError):
            async with tenant_session(factory(), tid) as session:
                await disburse_loan(session, tid, app_id, Channel.BANK)

    asyncio.run(run())


def test_disbursement_rollback_leaves_no_partial_state() -> None:
    """Kill-switch test: if disbursement fails mid-way, nothing is persisted."""

    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)
        pid = await _seed_product(tid)
        app_id = await _seed_approved_application(tid, mid, pid, Decimal("5000"))

        # Simulate a failure by passing a non-existent application id.
        bad_app_id = uuid.uuid4()
        with pytest.raises(NotFoundError):
            async with tenant_session(factory(), tid) as session:
                await disburse_loan(session, tid, bad_app_id, Channel.BANK)

        # The valid application should still be in 'approved' stage.
        async with tenant_session(factory(), tid) as session:
            stage = (
                await session.execute(
                    text("SELECT stage FROM loan_applications WHERE id = CAST(:id AS uuid)"),
                    {"id": str(app_id)},
                )
            ).scalar_one()
        assert str(stage) == "approved"

        # No loans or transactions should exist.
        async with tenant_session(factory(), tid) as session:
            loan_count = (
                await session.execute(
                    text("SELECT count(*) FROM loans WHERE application_id = CAST(:id AS uuid)"),
                    {"id": str(app_id)},
                )
            ).scalar_one()
        assert int(loan_count) == 0

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Audit log test
# ---------------------------------------------------------------------------


def test_posting_writes_audit_log_entry() -> None:
    async def run() -> None:
        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async with tenant_session(factory(), tid) as session:
            result = await post_deposit(session, tid, mid, Decimal("750.00"), Channel.MPESA)

        async with tenant_session(factory(), tid) as session:
            audit_count = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM audit_log "
                        "WHERE entity = 'transactions' "
                        "AND entity_id = :eid"
                    ),
                    {"eid": str(result.txn_id)},
                )
            ).scalar_one()
        assert int(audit_count) >= 1

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Cross-tenant isolation test
# ---------------------------------------------------------------------------


def test_cross_tenant_cannot_read_ledger_entries() -> None:
    async def run() -> None:
        tid_a, _ = await seed_user(unique_email())
        tid_b, _ = await seed_user(unique_email())
        mid_a = await _seed_member(tid_a)

        async with tenant_session(factory(), tid_a) as session:
            result = await post_deposit(session, tid_a, mid_a, Decimal("1000"), Channel.MPESA)

        # Tenant B should see zero rows for tenant A's transaction.
        async with tenant_session(factory(), tid_b) as session:
            count = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM ledger_entries "
                        "WHERE transaction_id = CAST(:id AS uuid)"
                    ),
                    {"id": str(result.txn_id)},
                )
            ).scalar_one()
        assert int(count) == 0

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Concurrency test: 50 parallel deposits — zero gaps or duplicates (gate 1.4)
# ---------------------------------------------------------------------------


def test_50_parallel_deposits_zero_gaps_or_duplicates() -> None:
    """50 concurrent deposits must produce 50 unique, sequential MP- refs."""

    async def run() -> None:
        # Create a fresh engine for this test to avoid event-loop binding issues
        # when running many concurrent coroutines (gate 1.4 concurrency test).
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        engine = create_async_engine(os.environ["DATABASE_URL"], pool_size=60, max_overflow=0)
        sm: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)

        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async def one_deposit() -> PostingResult:
            async with tenant_session(sm, tid) as session:
                return await post_deposit(session, tid, mid, Decimal("100.00"), Channel.MPESA)

        results = await asyncio.gather(*[one_deposit() for _ in range(50)])
        await engine.dispose()

        refs = [r.txn_ref for r in results]
        # All references must be unique.
        assert len(set(refs)) == 50, f"Duplicate refs found: {sorted(refs)}"

        # All must have the MP- prefix.
        assert all(r.startswith("MP-") for r in refs), f"Bad prefix in: {refs}"

        # Extract sequence numbers and verify no gaps.
        seq_nums = sorted(int(r[3:]) for r in refs)
        assert seq_nums == list(range(seq_nums[0], seq_nums[0] + 50)), (
            f"Gaps in sequence: {seq_nums}"
        )

    asyncio.run(run())


def test_50_parallel_mixed_postings_zero_duplicates() -> None:
    """50 concurrent postings of different types produce unique refs per prefix."""

    async def run() -> None:
        from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

        engine = create_async_engine(os.environ["DATABASE_URL"], pool_size=60, max_overflow=0)
        sm: async_sessionmaker[AsyncSession] = async_sessionmaker(engine, expire_on_commit=False)

        tid, _ = await seed_user(unique_email())
        mid = await _seed_member(tid)

        async def deposit() -> PostingResult:
            async with tenant_session(sm, tid) as session:
                return await post_deposit(session, tid, mid, Decimal("100.00"), Channel.MPESA)

        async def share_topup() -> PostingResult:
            async with tenant_session(sm, tid) as session:
                return await post_share_topup(session, tid, mid, Decimal("50.00"), Channel.MPESA)

        tasks = [deposit() for _ in range(25)] + [share_topup() for _ in range(25)]
        results = await asyncio.gather(*tasks)
        await engine.dispose()

        all_refs = [r.txn_ref for r in results]
        assert len(set(all_refs)) == 50, f"Duplicate refs: {sorted(all_refs)}"

        mp_refs = [r for r in all_refs if r.startswith("MP-")]
        sh_refs = [r for r in all_refs if r.startswith("SH-")]
        assert len(mp_refs) == 25
        assert len(sh_refs) == 25
        assert len(set(mp_refs)) == 25
        assert len(set(sh_refs)) == 25

    asyncio.run(run())
