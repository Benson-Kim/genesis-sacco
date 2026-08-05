"""EXPLAIN capture for the member-aggregates read (#31 batch 3, gate 1.3).

Writes the real EXPLAIN (ANALYZE, BUFFERS) output to
backend/perf/explain_member_aggregates.txt (CI artifact via the
backend/perf/ convention). The SQL under test is imported from the
production module — MEMBER_AGGREGATES_SQL is the exact statement the
single-member read executes.

Index story — this feature ships NO migration: all four scalar
subqueries ride indexes that shipped with their tables in 0001:

  * deposits/shares: the (tenant_id, member_id) UNIQUE-key probes on
    deposit_accounts / share_accounts;
  * loans outstanding: idx_loans_member;
  * guarantees pledged: idx_guarantees_guarantor.

Tiny CI tables make seqscan the cheaper plan; the capture disables it
for the session to prove each relation is SERVABLE by its index (plan
shape at scale — the P10..P13.11 precedent). On single-digit row
counts the planner may satisfy a tenant predicate from ANY
tenant-leading index of the relation, so the gates are STRUCTURAL per
the documented P13.11 movements-plan convention: every relation
index-served, zero sequential scans. Falsifiable: drop a relation's
indexes and its subquery must seq-scan (enable_seqscan=off only
penalises the cost), failing the gate.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db_helpers import factory
from export_helpers import seed_actor
from genesis.application.guarantees import live_guarantee_params
from genesis.application.members import MEMBER_AGGREGATES_SQL
from genesis.domain.lending import LoanStatus
from genesis.infrastructure.tenancy import tenant_session
from test_member_aggregates import _seed_guarantee, _seed_loan, _seed_member, _seed_product

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)

OUT_PATH = Path(__file__).resolve().parents[1] / "perf" / "explain_member_aggregates.txt"


async def _explain(session: AsyncSession, sql: str, params: dict[str, object]) -> str:
    rows = (await session.execute(text(f"EXPLAIN (ANALYZE, BUFFERS) {sql}"), params)).scalars()
    return "\n".join(str(r) for r in rows)


def test_member_aggregates_read_is_index_backed() -> None:
    async def run() -> None:
        tid, _, _ = await seed_actor()
        member = await _seed_member(tid, deposit="1000.00", shares="500.00")
        other = await _seed_member(tid, name="Borrower")
        pid = await _seed_product(tid)
        await _seed_loan(tid, member, pid, balance="750.00", status="active")
        await _seed_guarantee(
            tid, guarantor=member, borrower=other, amount="150.00", status="pledged"
        )

        async with tenant_session(factory(), tid) as session:
            await session.execute(text("SET LOCAL enable_seqscan = off"))
            plan = await _explain(
                session,
                MEMBER_AGGREGATES_SQL,
                {
                    "mid": str(member),
                    "tid": str(tid),
                    "loan_active": LoanStatus.ACTIVE.value,
                    **live_guarantee_params(),
                },
            )

        # Capture the artifact BEFORE any assertion so the CI job log
        # and backend/perf/ artifact always carry the full plan.
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        header = (
            "Member-aggregates EXPLAIN (ANALYZE, BUFFERS) — captured in CI\n"
            "against the migrated Postgres service under the RLS app role.\n"
            "enable_seqscan=off because CI tables are tiny; the assertion is\n"
            "that all four scalar subqueries are index-served at scale by the\n"
            "indexes that shipped with their tables in 0001: the account-table\n"
            "(tenant_id, member_id) UNIQUE keys, idx_loans_member and\n"
            "idx_guarantees_guarantor — the gate is structural (index-served,\n"
            "zero seq scans; the P13.11 movements-plan convention). This\n"
            "feature ships NO migration.\n"
        )
        OUT_PATH.write_text(f"{header}\n=== member aggregates (one SELECT) ===\n{plan}\n")

        assert "Seq Scan" not in plan, "an aggregate subquery fell back to a sequential scan"
        assert "Index" in plan, "the member-aggregates read is not index-served"
        # Relation anchors: the plan must actually touch all four hot
        # tables (guards against a rewritten/misdirected statement
        # passing the structural gate vacuously). Index NAMES are not
        # pinned: on single-digit CI rows the planner may serve a
        # tenant predicate from any tenant-leading index (the P13.11
        # convention).
        assert "deposit_accounts" in plan
        assert "share_accounts" in plan
        assert "loans" in plan
        assert "guarantees" in plan

    asyncio.run(run())
