"""Portfolio-at-risk aging export (P13.10 on the P13 registry).

FM1/H2 — bucket-boundary oracles: loans at EXACTLY 30/31/90/91/180/
181/360/361 days past due land in the documented CLOSED integer
buckets [0,30] [31,90] [91,180] [181,360] [361,inf) (the half-open
real intervals (30,90] etc. on whole days), including a hand-computed
leap-window pair. Balances and dpd are reconstructed from
schedule-vs-repayment history (the NPL-trend method, v1.1 rule 2) —
pinned by a drift-detector arm proving raw mutation of loans.balance /
days_past_due / classification does NOT change the report.

Every figure is hand-computed in comments (MASTER_PROMPT section 4);
each guard test fails with its guard removed (see the falsifiability
notes per test).
"""

from __future__ import annotations

import asyncio
import os
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import text

from db_helpers import factory
from export_helpers import count, seed_actor, seed_member
from genesis.application.exports import run_export
from genesis.application.reports import REPORTS, ExportFilters, ReportName
from genesis.infrastructure.tenancy import tenant_session
from test_reports_e2e import (
    _insert_txn,
    _seed_loan_for_book,
    download,
    parse_csv,
    request_and_render,
)

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)

_MONEY = re.compile(r"-?\d+\.\d{2}")

_HEADERS = ["Bucket (days past due)", "Loans", "Outstanding", "% of Portfolio"]


async def _add_installment(
    tid: uuid.UUID,
    loan_id: uuid.UUID,
    *,
    installment_no: int,
    due: date,
    total_due: str,
) -> None:
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO loan_schedules "
                "(id, tenant_id, loan_id, installment_no, due_date, "
                " principal_due, interest_due, total_due) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:lid AS uuid), "
                ":no, :due, :total, 0, :total)"
            ),
            {
                "id": str(uuid.uuid4()),
                "tid": str(tid),
                "lid": str(loan_id),
                "no": installment_no,
                "due": due,
                "total": total_due,
            },
        )


async def _render_par(tid: uuid.UUID, as_of: datetime) -> list[tuple[object, ...]]:
    """Drive the report through the REAL export engine (gate 1.1)."""
    async with tenant_session(factory(), tid) as session:
        query = await REPORTS[ReportName.PORTFOLIO_AT_RISK_AGING].build(
            session, tid, ExportFilters(), as_of
        )
        run = await run_export(query, 100, row_cap=1000)
    return [tuple(row) for row in run.rows]


def test_fm1_boundary_days_land_in_the_documented_buckets() -> None:
    """FM1/H2: eight loans, one unpaid installment each, due EXACTLY
    30/31/90/91/180/181/360/361 days before the as-of date, plus one
    current loan with no schedule (dpd 0). No repayments, so every
    outstanding balance equals its principal.

    HAND-COMPUTED buckets (as-of 2026-08-01; due = as-of - N days):
      0-30    : dpd 30 (1,000) + dpd 0 current (900) -> 2 loans, 1,900.00
      31-90   : dpd 31 (2,000) + dpd 90 (3,000)      -> 2 loans, 5,000.00
      91-180  : dpd 91 (4,000) + dpd 180 (5,000)     -> 2 loans, 9,000.00
      181-360 : dpd 181 (6,000) + dpd 360 (7,000)    -> 2 loans, 13,000.00
      360+    : dpd 361 (8,000)                      -> 1 loan,  8,000.00
      TOTAL   : 9 loans, 36,900.00
    Shares (2dp): 1900/36900 = 5.15%, 5000/36900 = 13.55%,
    9000/36900 = 24.39%, 13000/36900 = 35.23%, 8000/36900 = 21.68%
    (sum 100.00). Falsifiable: change any <= in the SQL CASE to < and
    the 30/90/180/360 loans shift one bucket up, failing the vectors.
    """

    async def run() -> None:
        tid, _, _ = await seed_actor()
        mid = await seed_member(tid)
        as_of = datetime(2026, 8, 1, 12, 0, tzinfo=UTC)
        d_date = as_of.date()
        for days, principal in (
            (30, "1000.00"),
            (31, "2000.00"),
            (90, "3000.00"),
            (91, "4000.00"),
            (180, "5000.00"),
            (181, "6000.00"),
            (360, "7000.00"),
            (361, "8000.00"),
        ):
            loan_id = await _seed_loan_for_book(
                tid, mid, principal=principal, balance=principal, disbursed_days_ago=2000
            )
            await _add_installment(
                tid,
                loan_id,
                installment_no=1,
                due=d_date - timedelta(days=days),
                total_due="500.00",
            )
        # The current loan: disbursed, no installment due -> dpd 0.
        await _seed_loan_for_book(
            tid, mid, principal="900.00", balance="900.00", disbursed_days_ago=2000
        )

        rows = await _render_par(tid, as_of)
        assert rows == [
            ("0-30", 2, Decimal("1900.00"), Decimal("5.15")),
            ("31-90", 2, Decimal("5000.00"), Decimal("13.55")),
            ("91-180", 2, Decimal("9000.00"), Decimal("24.39")),
            ("181-360", 2, Decimal("13000.00"), Decimal("35.23")),
            ("360+", 1, Decimal("8000.00"), Decimal("21.68")),
            ("TOTAL", 9, Decimal("36900.00"), Decimal("100.00")),
        ]

    asyncio.run(run())


def test_h2_leap_window_days_are_counted_on_the_real_calendar() -> None:
    """H2 leap-window oracle: the SAME calendar offsets straddle a
    bucket boundary depending on whether February 29 exists in the
    window — days past due must be REAL elapsed days, never a 30-day
    month approximation.

    HAND-COMPUTED:
      * Loan L due 2024-01-30, as-of 2024-03-01 (2024 is a leap year):
        Jan 30 -> Feb 29 is 30 days, +1 -> Mar 1 = 31 dpd -> "31-90".
      * Loan M due 2025-01-30, as-of 2025-03-01 (non-leap):
        Jan 30 -> Feb 28 is 29 days, +1 -> Mar 1 = 30 dpd -> "0-30".
      * At the 2025 as-of, L is 396 dpd (366 leap-year days to
        2025-01-30, +30) -> "360+".
    M is disbursed 2024-06-01, AFTER the 2024 as-of, so the leap run
    sees only L. Falsifiable: a 30-day-month dpd approximation makes
    both loans 30 dpd and the leap-run bucket vector fails.
    """

    async def run() -> None:
        tid, _, _ = await seed_actor()
        mid = await seed_member(tid)
        as_of_leap = datetime(2024, 3, 1, 12, 0, tzinfo=UTC)
        as_of_nonleap = datetime(2025, 3, 1, 12, 0, tzinfo=UTC)
        today = datetime.now(UTC).date()

        loan_l = await _seed_loan_for_book(
            tid,
            mid,
            principal="1500.00",
            balance="1500.00",
            disbursed_days_ago=(today - date(2023, 6, 1)).days,
        )
        await _add_installment(
            tid, loan_l, installment_no=1, due=date(2024, 1, 30), total_due="500.00"
        )
        loan_m = await _seed_loan_for_book(
            tid,
            mid,
            principal="2500.00",
            balance="2500.00",
            disbursed_days_ago=(today - date(2024, 6, 1)).days,
        )
        await _add_installment(
            tid, loan_m, installment_no=1, due=date(2025, 1, 30), total_due="500.00"
        )

        leap_rows = await _render_par(tid, as_of_leap)
        assert leap_rows == [
            ("0-30", 0, Decimal("0.00"), Decimal("0.00")),
            ("31-90", 1, Decimal("1500.00"), Decimal("100.00")),
            ("91-180", 0, Decimal("0.00"), Decimal("0.00")),
            ("181-360", 0, Decimal("0.00"), Decimal("0.00")),
            ("360+", 0, Decimal("0.00"), Decimal("0.00")),
            ("TOTAL", 1, Decimal("1500.00"), Decimal("100.00")),
        ]

        nonleap_rows = await _render_par(tid, as_of_nonleap)
        # 1500/4000 = 37.50%, 2500/4000 = 62.50%.
        assert nonleap_rows == [
            ("0-30", 1, Decimal("2500.00"), Decimal("62.50")),
            ("31-90", 0, Decimal("0.00"), Decimal("0.00")),
            ("91-180", 0, Decimal("0.00"), Decimal("0.00")),
            ("181-360", 0, Decimal("0.00"), Decimal("0.00")),
            ("360+", 1, Decimal("1500.00"), Decimal("37.50")),
            ("TOTAL", 2, Decimal("4000.00"), Decimal("100.00")),
        ]

    asyncio.run(run())


def test_reconstruction_and_drift_detector_end_to_end() -> None:
    """The report is built from schedule-vs-repayment history, never
    from mutable loan-state columns (v1.1 rule 2; the P13.9 FM1
    drift-detector style).

    HAND-COMPUTED: principal 10,000.00; installments 3,000.00 due 100
    days ago and 3,000.00 due 40 days ago; one repayment of 3,000.00
    (60 days ago) with a 2,500.00 loans.receivable principal leg (the
    other 500.00 recognised as interest income). Cash paid 3,000.00
    meets installment #1 exactly (cum_due 3,000 not > 3,000); #2 is
    unmet -> dpd 40 -> bucket "31-90". Outstanding = 10,000.00 -
    2,500.00 = 7,500.00.

    Drift arm: raw-mutating loans.balance/days_past_due/classification
    afterwards changes NOTHING. Falsifiable: rebuild the report on
    loans.balance (or loans.days_past_due) and the second render shows
    1.00 / bucket 360+, failing the equality.
    """

    async def run() -> None:
        tid, _, token = await seed_actor()
        mid = await seed_member(tid)
        today = datetime.now(UTC).date()
        loan_id = await _seed_loan_for_book(
            tid, mid, principal="10000.00", balance="10000.00", disbursed_days_ago=150
        )
        await _add_installment(
            tid, loan_id, installment_no=1, due=today - timedelta(days=100), total_due="3000.00"
        )
        await _add_installment(
            tid, loan_id, installment_no=2, due=today - timedelta(days=40), total_due="3000.00"
        )
        txn_id = await _insert_txn(
            tid, ref="RP-777001", txn_type="loan_repayment", amount="3000.00", days_ago=60
        )
        async with tenant_session(factory(), tid) as session:
            await session.execute(
                text(
                    "INSERT INTO repayments (id, tenant_id, loan_id, transaction_id, amount) "
                    "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:lid AS uuid), "
                    "CAST(:txn AS uuid), '3000.00')"
                ),
                {"id": str(uuid.uuid4()), "tid": str(tid), "lid": str(loan_id), "txn": str(txn_id)},
            )
            # Balanced legs (0004 trigger): DR cash 3000 / CR receivable
            # 2500 + CR interest income 500.
            for account, side, amount in (
                ("cash.bank", "debit", "3000.00"),
                ("loans.receivable", "credit", "2500.00"),
                ("income.interest", "credit", "500.00"),
            ):
                await session.execute(
                    text(
                        "INSERT INTO ledger_entries "
                        "(id, tenant_id, transaction_id, account, side, amount) "
                        "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:txn AS uuid), "
                        ":account, :side, :amount)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "tid": str(tid),
                        "txn": str(txn_id),
                        "account": account,
                        "side": side,
                        "amount": amount,
                    },
                )

        _, completed = await request_and_render(token, tid, {"report": "portfolio_at_risk_aging"})
        artifact = completed["artifact"]
        assert artifact is not None
        status, headers, body = await download(token, artifact["csv_download"])
        assert status == 200
        assert headers["x-export-truncated"] == "false"
        rows = parse_csv(body)
        assert rows[0] == _HEADERS
        assert rows[2] == ["31-90", "1", "7500.00", "100.00"]
        assert rows[6] == ["TOTAL", "1", "7500.00", "100.00"]

        # H3: every money cell renders in the canonical 2dp form (the
        # !34 '0' vs '0.00' inconsistency class).
        for row in rows[1:]:
            assert _MONEY.fullmatch(row[2]), row
            assert _MONEY.fullmatch(row[3]), row

        # Export audit row for the run (P13 blocker f).
        assert (
            await count(
                tid,
                "SELECT count(*) FROM audit_log WHERE action = 'export.completed' "
                "AND after->>'report' = 'portfolio_at_risk_aging'",
            )
            == 1
        )

        # Drift arm: mutate every mutable loan-state column raw.
        async with tenant_session(factory(), tid) as session:
            await session.execute(
                text(
                    "UPDATE loans SET balance = '1.00', days_past_due = 999, "
                    "classification = 'loss' "
                    "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
                ),
                {"id": str(loan_id), "tid": str(tid)},
            )
        _, second = await request_and_render(token, tid, {"report": "portfolio_at_risk_aging"})
        artifact_two = second["artifact"]
        assert artifact_two is not None
        _, _, body_two = await download(token, artifact_two["csv_download"])
        assert parse_csv(body_two) == rows  # reconstruction, not state

    asyncio.run(run())
