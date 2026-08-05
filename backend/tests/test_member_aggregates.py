"""Member aggregates on the single-member read (#31 batch 3).

Every oracle below is hand-computed in comments from the seeded rows,
never captured from the implementation (the P13.9 precedent). The legs:

  * fixture oracle — deposits/shares read the P11 balance columns;
    loans_outstanding sums ACTIVE balances only (a deliberately
    NONZERO closed row and a written-off row prove the status filter
    is load-bearing); guarantees_pledged sums the LIVE (pledged +
    active) status set only (a released row proves the filter; a row
    where the member is the BORROWER proves the guarantor predicate).
  * zero-activity serialization — a freshly registered member returns
    '0.00' for all four figures, never bare '0' (the CAST to
    numeric(18,2) normalises the empty-SUM zero).
  * least disclosure + RBAC — the aggregates object carries exactly
    four keys; the register LIST stays flat (no aggregates key); a
    role without members:view gets 403 and no rejection path (403,
    404, cross-tenant 404) ever echoes an amount.
  * cross-tenant bleed probe (issue #17) — a session bound AS tenant B
    given tenant A's ids yields zeros, never a mixed aggregate.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import text

from db_helpers import api_client, factory
from export_helpers import add_user, seed_actor
from genesis.application.members import member_aggregates
from genesis.infrastructure.tenancy import tenant_session

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)


def _headers(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


async def _seed_member(
    tid: uuid.UUID,
    *,
    name: str = "Agg Member",
    deposit: str = "0",
    shares: str = "0",
) -> uuid.UUID:
    mid = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO members (id, tenant_id, member_no, type, name, status) VALUES "
                "(CAST(:id AS uuid), CAST(:tid AS uuid), :no, 'person', :name, 'active')"
            ),
            {"id": str(mid), "tid": str(tid), "no": f"GP-{mid.hex[:6].upper()}", "name": name},
        )
        for table, bal in (("deposit_accounts", deposit), ("share_accounts", shares)):
            await session.execute(
                text(
                    # Table name from test code, never user input.
                    f"INSERT INTO {table} (id, tenant_id, member_id, balance) VALUES "  # noqa: S608
                    "(CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:m AS uuid), :bal)"
                ),
                {"id": str(uuid.uuid4()), "tid": str(tid), "m": str(mid), "bal": bal},
            )
    return mid


async def _seed_product(tid: uuid.UUID) -> uuid.UUID:
    pid = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO loan_products "
                "(id, tenant_id, name, rate_pct, deposit_multiplier, max_term_months) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), :name, '12.00', '3.00', 36)"
            ),
            {"id": str(pid), "tid": str(tid), "name": f"AGG-{uuid.uuid4().hex[:8]}"},
        )
    return pid


async def _seed_loan(
    tid: uuid.UUID,
    mid: uuid.UUID,
    pid: uuid.UUID,
    *,
    balance: str,
    status: str = "active",
) -> uuid.UUID:
    """Loan + its backing application, seeded raw at a chosen status.

    The status is a raw column write on purpose: a closed row seeded
    with a NONZERO balance is unreachable through the closure rule, so
    the aggregate's status filter is the ONLY thing keeping it out of
    loans_outstanding — remove the filter and the oracle fails.
    """
    aid = uuid.uuid4()
    loan_id = uuid.uuid4()
    async with tenant_session(factory(), tid) as session:
        await session.execute(
            text(
                "INSERT INTO loan_applications "
                "(id, tenant_id, member_id, product_id, amount, term_months, "
                " rate_pct, stage, cover_pct) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:mid AS uuid), "
                "CAST(:pid AS uuid), :amount, 12, '12.00', 'disbursed', '0.00')"
            ),
            {
                "id": str(aid),
                "tid": str(tid),
                "mid": str(mid),
                "pid": str(pid),
                "amount": balance if Decimal(balance) > 0 else "1.00",
            },
        )
        await session.execute(
            text(
                "INSERT INTO loans "
                "(id, tenant_id, application_id, member_id, product_id, "
                " principal, balance, rate_pct, term_months, status) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:aid AS uuid), "
                "CAST(:mid AS uuid), CAST(:pid AS uuid), :principal, :balance, "
                "'12.00', 12, :status)"
            ),
            {
                "id": str(loan_id),
                "tid": str(tid),
                "aid": str(aid),
                "mid": str(mid),
                "pid": str(pid),
                "principal": balance if Decimal(balance) > 0 else "1.00",
                "balance": balance,
                "status": status,
            },
        )
    return loan_id


async def _seed_guarantee(
    tid: uuid.UUID,
    *,
    guarantor: uuid.UUID,
    borrower: uuid.UUID,
    amount: str,
    status: str,
) -> None:
    async with tenant_session(factory(), tid) as session:
        attestor = None
        if status == "active":
            # P14.5 FM4: the 0035 trigger refuses a row ENTERING
            # 'active' without a principal, so seeded active fixtures
            # carry a staff attestation (any tenant user).
            attestor = (await session.execute(text("SELECT id FROM users LIMIT 1"))).scalar_one()
        await session.execute(
            text(
                "INSERT INTO guarantees "
                "(id, tenant_id, guarantor_member_id, borrower_member_id, amount, status, "
                " consent_attested_by, consent_reference) "
                "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:g AS uuid), "
                "CAST(:b AS uuid), :amount, :status, CAST(:att AS uuid), :cref)"
            ),
            {
                "id": str(uuid.uuid4()),
                "tid": str(tid),
                "g": str(guarantor),
                "b": str(borrower),
                "amount": amount,
                "status": status,
                "att": str(attestor) if attestor is not None else None,
                "cref": "seeded fixture (P14.5 FM4)" if attestor is not None else None,
            },
        )


# ---------------------------------------------------------------------------
# Fixture oracle — hand-computed, to the cent
# ---------------------------------------------------------------------------


def test_member_aggregates_match_hand_computed_oracles() -> None:
    """Oracle (hand-computed from the seeds, never from the code):

    deposits_total      = 1500.50 (balance column, one row)
    shares_total        =  750.25 (balance column, one row)
    loans_outstanding   = 2000.00 + 500.10          = 2500.10
                          (closed 999.99 and written-off 100.00 excluded)
    guarantees_pledged  =  600.00 + 400.40          = 1000.40
                          (released 123.45 excluded; the 77.77 row where
                           the member is the BORROWER excluded)
    """

    async def run() -> None:
        tid, _, token = await seed_actor()
        member = await _seed_member(tid, deposit="1500.50", shares="750.25")
        other = await _seed_member(tid, name="Counterparty")
        pid = await _seed_product(tid)
        await _seed_loan(tid, member, pid, balance="2000.00", status="active")
        await _seed_loan(tid, member, pid, balance="500.10", status="active")
        await _seed_loan(tid, member, pid, balance="999.99", status="closed")
        await _seed_loan(tid, member, pid, balance="100.00", status="written_off")
        await _seed_guarantee(
            tid, guarantor=member, borrower=other, amount="600.00", status="pledged"
        )
        await _seed_guarantee(
            tid, guarantor=member, borrower=other, amount="400.40", status="active"
        )
        await _seed_guarantee(
            tid, guarantor=member, borrower=other, amount="123.45", status="released"
        )
        await _seed_guarantee(
            tid, guarantor=other, borrower=member, amount="77.77", status="pledged"
        )

        async with api_client() as client:
            res = await client.get(f"/members/{member}", headers=_headers(token))
        assert res.status_code == 200, res.text
        body = res.json()
        # Least disclosure: exactly the four amounts, nothing else.
        assert body["aggregates"] == {
            "deposits_total": "1500.50",
            "shares_total": "750.25",
            "loans_outstanding": "2500.10",
            "guarantees_pledged": "1000.40",
        }
        # Expand-only: the established member fields are untouched.
        assert body["id"] == str(member)
        assert body["status"] == "active"
        assert body["version"] == 1

    asyncio.run(run())


def test_zero_activity_member_serializes_canonical_zero() -> None:
    """A member fresh out of registration (real flow: accounts open at
    zero, no loans, no guarantees) serializes '0.00' for every figure —
    never bare '0' (the CAST normalises the empty-SUM zero)."""

    async def run() -> None:
        _, _, token = await seed_actor()
        async with api_client() as client:
            created = await client.post(
                "/members",
                json={"type": "person", "name": "Zero Activity"},
                headers=_headers(token),
            )
            assert created.status_code == 201, created.text
            res = await client.get(f"/members/{created.json()['id']}", headers=_headers(token))
        assert res.status_code == 200, res.text
        assert res.json()["aggregates"] == {
            "deposits_total": "0.00",
            "shares_total": "0.00",
            "loans_outstanding": "0.00",
            "guarantees_pledged": "0.00",
        }

    asyncio.run(run())


# ---------------------------------------------------------------------------
# Least disclosure, RBAC, list shape, cross-tenant
# ---------------------------------------------------------------------------


def test_member_list_stays_flat_without_aggregates() -> None:
    """The register LIST is untouched (no per-row aggregate fan-out,
    gate 1.3): list items carry NO aggregates key."""

    async def run() -> None:
        tid, _, token = await seed_actor()
        await _seed_member(tid, deposit="10.00")
        async with api_client() as client:
            res = await client.get("/members", headers=_headers(token))
        assert res.status_code == 200, res.text
        items = res.json()["items"]
        assert len(items) >= 1
        assert all("aggregates" not in item for item in items)

    asyncio.run(run())


def test_aggregates_rbac_and_no_rejection_path_echoes_amounts() -> None:
    """members:view gates the read (Credit Committee holds no members
    grant — P4 matrix); neither the 403 nor any 404 leg ever carries a
    seeded amount (least disclosure, gate 1.6)."""

    async def run() -> None:
        tid, _, admin_token = await seed_actor()
        member = await _seed_member(tid, deposit="8642.31", shares="1357.90")
        _, committee_token = await add_user(tid, "Credit Committee")
        _, _, foreign_token = await seed_actor()

        async with api_client() as client:
            forbidden = await client.get(f"/members/{member}", headers=_headers(committee_token))
            unknown = await client.get(f"/members/{uuid.uuid4()}", headers=_headers(admin_token))
            cross = await client.get(f"/members/{member}", headers=_headers(foreign_token))
        assert forbidden.status_code == 403
        # RLS hides the row from the foreign tenant: 404, not 403 —
        # existence is not disclosed either.
        assert unknown.status_code == 404
        assert cross.status_code == 404
        for res in (forbidden, unknown, cross):
            assert "8642.31" not in res.text
            assert "1357.90" not in res.text
            assert "aggregates" not in res.text

    asyncio.run(run())


def test_cross_tenant_argument_yields_zeros_not_mixed_aggregates() -> None:
    """Issue-#17 probe (the dashboard FM2 precedent): a session bound
    AS tenant B given tenant A's ids must see zeros — RLS and the
    explicit tenant predicate agree, never a mixed aggregate."""

    async def run() -> None:
        tid_a, _, _ = await seed_actor()
        tid_b, _, _ = await seed_actor()
        member = await _seed_member(tid_a, deposit="500.00", shares="250.00")
        async with tenant_session(factory(), tid_b) as session:
            figures = await member_aggregates(session, tid_a, member)
        assert figures.deposits_total == Decimal("0.00")
        assert figures.shares_total == Decimal("0.00")
        assert figures.loans_outstanding == Decimal("0.00")
        assert figures.guarantees_pledged == Decimal("0.00")

    asyncio.run(run())
