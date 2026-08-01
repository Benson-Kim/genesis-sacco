"""tenant settings, parameters & approval matrix (P13.7)

Revision ID: 0017
Revises: 0016
Create Date: 2026-07-31

Numbering note: this revision originally chained from 0015, reserving
0016 for the then-in-flight P13.6 branches registry. P13.6 has since
merged to main, so down_revision now points at 0016 and the alembic
chain is linear again (the re-chain recorded in the MR).

Expand-only revision backing BUILD_PROMPTS P13.7: generalise
tenant_settings (0009: deposit-interest rate; 0010: exit fee) into the
prototype Settings screens' backend (GAP_ANALYSIS 2.9). One row per
tenant (PK tenant_id — every settings read is a single PK lookup);
every column nullable, NULL = "not configured, consumers fall back to
the code-owned default". DB CHECKs on every bound (gate 1.5); the
management API (the single legitimate writer, gate 1.6 v1.1 rule 1)
revalidates the same bounds at the boundary.

  1. deposit_interest_annual_rate_pct DROP NOT NULL — the settings row
     now exists as soon as ANY setting is configured, so the deposit
     rate becomes optional like every other key. The 0009 CHECK stays
     (NULL satisfies a CHECK); the accrual job treats a NULL rate
     exactly like a missing row (409 unconfigured, unchanged contract).

  2. Interest config: dividend %, penalty rate %/mo, penalty grace
     days, penalty charged-on basis, loan interest method/basis
     (STORED ONLY — the P6 engine extension is explicitly out of
     scope, see BUILD_PROMPTS P13.7), tiered loan-rate bands (JSONB,
     validated at write AND revalidated at read in
     genesis/domain/tenant_config.py; the DB CHECK pins the top-level
     type so a manual edit cannot smuggle a scalar).

  3. Global parameters: min share capital, registration fee, min
     monthly contribution, max member exposure, dormancy period,
     financial year end month, exit notice period.

  4. Approval matrix: committee size, committee quorum (consumed live
     by P9 cast_vote and P12 cast_exit_vote), per-authority amount
     bands (JSONB, consumed live by the P9 stage machine).

  5. loan_products.guarantors_required — the prototype Settings > Loan
     products "guarantors required" field. NOT NULL DEFAULT 0 is
     backfill-safe for existing rows (expand-only). Stored config in
     this prompt; disbursement-time enforcement is recorded as a
     follow-up in the MR.

No new tables and no new indexes: tenant_settings keeps its 0009 PK
and RLS policy (forced, tenant_isolation), which serve every new read.

Working downgrade fully reverses: new columns dropped; the NOT NULL on
the deposit rate is restored after deleting rows that hold a NULL rate
(such rows can only exist under this revision's API, so removing them
returns the schema AND data domain to the 0009 contract).
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

_UP = """
-- ---------------------------------------------------------------------------
-- 1. The settings row no longer requires the deposit rate (P13.7)
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_settings
    ALTER COLUMN deposit_interest_annual_rate_pct DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Interest configuration (prototype Settings > Interest tab)
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_settings
    ADD COLUMN dividend_rate_pct numeric(5,2)
        CHECK (dividend_rate_pct >= 0 AND dividend_rate_pct <= 100),
    ADD COLUMN penalty_rate_pct_per_month numeric(5,2)
        CHECK (penalty_rate_pct_per_month >= 0
               AND penalty_rate_pct_per_month <= 100),
    ADD COLUMN penalty_grace_days integer
        CHECK (penalty_grace_days >= 0 AND penalty_grace_days <= 365),
    ADD COLUMN penalty_charged_on text
        CHECK (penalty_charged_on IN ('instalment_in_arrears', 'full_outstanding')),
    ADD COLUMN loan_interest_method text
        CHECK (loan_interest_method IN ('reducing_balance', 'flat')),
    ADD COLUMN loan_interest_basis text
        CHECK (loan_interest_basis IN ('thirty_360', 'actual_365')),
    ADD COLUMN loan_rate_bands jsonb
        CHECK (jsonb_typeof(loan_rate_bands) = 'array');

-- ---------------------------------------------------------------------------
-- 3. Global parameters (prototype Settings > Parameters tab)
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_settings
    ADD COLUMN min_share_capital numeric(18,2)
        CHECK (min_share_capital >= 0),
    ADD COLUMN registration_fee numeric(18,2)
        CHECK (registration_fee >= 0),
    ADD COLUMN min_monthly_contribution numeric(18,2)
        CHECK (min_monthly_contribution >= 0),
    ADD COLUMN max_member_exposure numeric(18,2)
        CHECK (max_member_exposure >= 0),
    ADD COLUMN dormancy_period_months integer
        CHECK (dormancy_period_months >= 1 AND dormancy_period_months <= 120),
    ADD COLUMN financial_year_end_month integer
        CHECK (financial_year_end_month >= 1 AND financial_year_end_month <= 12),
    ADD COLUMN exit_notice_period_days integer
        CHECK (exit_notice_period_days >= 0 AND exit_notice_period_days <= 365);

-- ---------------------------------------------------------------------------
-- 4. Approval matrix (prototype Settings > Approval matrix tab)
-- ---------------------------------------------------------------------------
ALTER TABLE tenant_settings
    ADD COLUMN committee_size integer
        CHECK (committee_size >= 1 AND committee_size <= 25),
    ADD COLUMN committee_quorum integer
        CHECK (committee_quorum >= 1 AND committee_quorum <= 25),
    ADD COLUMN approval_bands jsonb
        CHECK (jsonb_typeof(approval_bands) = 'array'),
    ADD CONSTRAINT ck_tenant_settings_quorum_le_size
        CHECK (committee_quorum IS NULL OR committee_size IS NULL
               OR committee_quorum <= committee_size);

-- ---------------------------------------------------------------------------
-- 5. Per-product guarantors-required (prototype Settings > Loan products)
-- ---------------------------------------------------------------------------
ALTER TABLE loan_products
    ADD COLUMN guarantors_required integer NOT NULL DEFAULT 0
        CHECK (guarantors_required >= 0 AND guarantors_required <= 10);
"""

_DOWN = """
ALTER TABLE loan_products DROP COLUMN IF EXISTS guarantors_required;

ALTER TABLE tenant_settings
    DROP CONSTRAINT IF EXISTS ck_tenant_settings_quorum_le_size;
ALTER TABLE tenant_settings
    DROP COLUMN IF EXISTS approval_bands,
    DROP COLUMN IF EXISTS committee_quorum,
    DROP COLUMN IF EXISTS committee_size,
    DROP COLUMN IF EXISTS exit_notice_period_days,
    DROP COLUMN IF EXISTS financial_year_end_month,
    DROP COLUMN IF EXISTS dormancy_period_months,
    DROP COLUMN IF EXISTS max_member_exposure,
    DROP COLUMN IF EXISTS min_monthly_contribution,
    DROP COLUMN IF EXISTS registration_fee,
    DROP COLUMN IF EXISTS min_share_capital,
    DROP COLUMN IF EXISTS loan_rate_bands,
    DROP COLUMN IF EXISTS loan_interest_basis,
    DROP COLUMN IF EXISTS loan_interest_method,
    DROP COLUMN IF EXISTS penalty_charged_on,
    DROP COLUMN IF EXISTS penalty_grace_days,
    DROP COLUMN IF EXISTS penalty_rate_pct_per_month,
    DROP COLUMN IF EXISTS dividend_rate_pct;

-- Rows created without a deposit rate exist only under the 0017 API;
-- removing them restores the 0009 data domain before re-tightening.
DELETE FROM tenant_settings WHERE deposit_interest_annual_rate_pct IS NULL;
ALTER TABLE tenant_settings
    ALTER COLUMN deposit_interest_annual_rate_pct SET NOT NULL;
"""


def upgrade() -> None:
    op.execute(_UP)


def downgrade() -> None:
    op.execute(_DOWN)
