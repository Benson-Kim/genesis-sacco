"""P13.10 report indexes: membership register keyset (gate 1.3)

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-01

Claimed as 0023 with down_revision 0022 per v1.2 rule 14 — 0022
(dividends x dormancy policy, !36) verified as main's migration head
at branch time (0001-0022 linear). Indexes only, no new tables: no
TENANT_TABLES / ENTITY_MODULES / RLS delta.

The P13.10 membership register streams the full members table through
the export engine in (created_at, id) keyset order. This composite
index leads with tenant_id (matching the RLS predicate) so the keyset
page stays index-backed at any page depth (EXPLAIN gate:
tests/test_p1310_explain.py -> backend/perf/explain_p1310.txt).

The other P13.10 reports ship NO new index by design:
  * portfolio-at-risk aging reuses the NPL-trend reconstruction shape
    (idx_schedules_due / idx_repayments_loan / idx_ledger_txn /
    idx_loans_status, all shipped with their queries in 0001/0013);
  * income statement and SASRA return aggregate the ledger exactly
    like the P13 trial balance (idx_ledger_txn + transactions PK),
    with cardinality bounded by the chart of accounts.
"""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

_UP = """
CREATE INDEX idx_members_register_keyset
    ON members (tenant_id, created_at, id);
"""

_DOWN = """
DROP INDEX IF EXISTS idx_members_register_keyset;
"""


def upgrade() -> None:
    op.execute(_UP)


def downgrade() -> None:
    op.execute(_DOWN)
