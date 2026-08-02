"""per-account and per-member period rollups (P13.17b / DSA-2, DSA-5)

Revision ID: 0028
Revises: 0027
Create Date: 2026-08-02

Claimed as 0028 with down_revision 0027 (this MR's own (a) claim; the
chain is 0026 <- 0027 <- 0028 <- 0029, declared up front per v1.2 rule
14 — one number per separable item). Expand-only objects backing
P13.17(b):

  * accounting_periods.rollup_at — the rollup COMPLETENESS marker: set
    in the same transaction that writes the period's rollup rows (at
    close_period, or by the backfill job for periods closed before
    this revision). The trial balance and the statement-opening anchor
    trust ONLY periods whose marker is set; a closed-but-unrolled
    period keeps being served by the live scan, so the shortcut can
    never silently drop a period. The marker is WRITE-ONCE by trigger
    (a cleared marker would re-open the late-insert window below).

  * account_period_balances — per-account debit/credit totals for one
    closed period (DSA-2). The ledger is append-only and the 0012
    closed-period trigger refuses any transaction dated inside a
    closed period, so these totals are immutable facts the moment the
    close commits: trial balance = SUM(rollups of rolled periods) +
    live aggregate over everything else — provably equal to the full
    scan (the FM2 equality gate, tests/test_p1317_period_rollups.py).

  * member_period_balances — the member's ledger-reconstructed running
    balance at the period end (DSA-5), written only for members with
    activity in the period. Statement opening balance = latest rolled
    anchor + the delta since — same figures as the full history scan
    (FM2), computed via the SAME grouped-movement statement +
    member_direction single source of truth (v1.1 rule 2 is untouched:
    these are per-PERIOD facts derived from the append-only record,
    frozen by the 0012 trigger — not the point-in-time mutable-balance
    snapshots that rule forbids as an interest basis).

  * Insider hardening, all DB-level (FM2 — a drifted rollup that
    reports a balanced book is worse than no rollup):
      - WRITE-ONCE triggers: UPDATE/DELETE refused on both tables for
        every trigger-subject role, including direct SQL through the
        app role (0020 precedent);
      - LATE-INSERT fences: once a period's rollup_at is set, INSERT
        into either rollup table for that period is refused — a
        fabricated extra account/member row after completion is
        unrepresentable; before completion, a fabricated row is
        excluded from every read (marker not set) and collides with
        the backfill's claim, which verifies and 409s loudly;
      - composite FKs to accounting_periods(tenant_id, period_start):
        a rollup row for a period that was never closed is
        unrepresentable;
      - RLS enabled AND forced with the 0001 policy (ADR-0002);
        CHECKs pin debits/credits >= 0 and a non-empty account.

  * A future period-REOPEN action (0012 kept status additive for one)
    must handle rollups explicitly (refuse while rolled, or become a
    reviewed migration); the write-once posture here is deliberate.

Lock posture (0024 honesty precedent): ALTER TABLE accounting_periods
ADD COLUMN (nullable, no default) takes ACCESS EXCLUSIVE on
accounting_periods briefly — no rewrite; CREATE TRIGGER on
accounting_periods takes SHARE ROW EXCLUSIVE. Both block concurrent
period reads/postings for the duration — within this project's
accepted maintenance-window migration model. New tables lock nothing
in use.

Downgrade REFUSES LOUDLY while either rollup table holds rows
(0017/0020 precedent — closed-period money totals are never silently
deleted); on an empty database it drops the objects and the column,
landing exactly on 0027.
"""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

_UP = """
-- ---------------------------------------------------------------------------
-- 0. Rollup completeness marker (write-once)
-- ---------------------------------------------------------------------------
ALTER TABLE accounting_periods ADD COLUMN rollup_at timestamptz;

CREATE FUNCTION forbid_rollup_marker_clear() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF OLD.rollup_at IS NOT NULL
       AND NEW.rollup_at IS DISTINCT FROM OLD.rollup_at THEN
        RAISE EXCEPTION
            'accounting_periods.rollup_at is write-once: clearing or moving '
            'it would re-open the late-insert window (P13.17 FM2)';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER accounting_periods_rollup_marker_write_once
    BEFORE UPDATE ON accounting_periods
    FOR EACH ROW EXECUTE FUNCTION forbid_rollup_marker_clear();

-- ---------------------------------------------------------------------------
-- 1. Per-account period rollups (DSA-2)
-- ---------------------------------------------------------------------------
CREATE TABLE account_period_balances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    period_start date NOT NULL,
    account text NOT NULL CHECK (length(account) > 0),
    debits numeric(18,2) NOT NULL CHECK (debits >= 0),
    credits numeric(18,2) NOT NULL CHECK (credits >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    -- One row per account per period, claimed atomically (v1.1 rule
    -- 5); also the trial balance's rolled-CTE scan index (gate 1.3).
    CONSTRAINT uq_account_period_balances
        UNIQUE (tenant_id, period_start, account),
    -- A rollup for a never-closed period is unrepresentable.
    CONSTRAINT fk_account_period_balances_period
        FOREIGN KEY (tenant_id, period_start)
        REFERENCES accounting_periods (tenant_id, period_start)
        ON DELETE RESTRICT
);

-- ---------------------------------------------------------------------------
-- 2. Per-member period balances (DSA-5)
-- ---------------------------------------------------------------------------
CREATE TABLE member_period_balances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    period_start date NOT NULL,
    member_id uuid NOT NULL REFERENCES members(id) ON DELETE RESTRICT,
    balance numeric(18,2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_member_period_balances
        UNIQUE (tenant_id, period_start, member_id),
    CONSTRAINT fk_member_period_balances_period
        FOREIGN KEY (tenant_id, period_start)
        REFERENCES accounting_periods (tenant_id, period_start)
        ON DELETE RESTRICT
);

-- The statement-opening anchor probe: latest rolled period before the
-- window start, per member (gate 1.3 — ships with the query it
-- serves); also indexes the member_id FK.
CREATE INDEX idx_member_period_balances_anchor
    ON member_period_balances (tenant_id, member_id, period_start DESC);

-- ---------------------------------------------------------------------------
-- 3. Write-once + late-insert fences (FM2)
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_period_rollup_mutation() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION
        '% is write-once: period % rows may never be updated or deleted '
        '(P13.17 FM2)', TG_TABLE_NAME, OLD.period_start;
END
$fn$;

CREATE TRIGGER account_period_balances_write_once
    BEFORE UPDATE OR DELETE ON account_period_balances
    FOR EACH ROW EXECUTE FUNCTION forbid_period_rollup_mutation();

CREATE TRIGGER member_period_balances_write_once
    BEFORE UPDATE OR DELETE ON member_period_balances
    FOR EACH ROW EXECUTE FUNCTION forbid_period_rollup_mutation();

CREATE FUNCTION forbid_late_period_rollup_insert() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF EXISTS (
        SELECT 1 FROM accounting_periods p
        WHERE p.tenant_id = NEW.tenant_id
          AND p.period_start = NEW.period_start
          AND p.rollup_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION
            '% rows for period % are complete (rollup_at set): late inserts '
            'are refused (P13.17 FM2)', TG_TABLE_NAME, NEW.period_start;
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER account_period_balances_no_late_insert
    BEFORE INSERT ON account_period_balances
    FOR EACH ROW EXECUTE FUNCTION forbid_late_period_rollup_insert();

CREATE TRIGGER member_period_balances_no_late_insert
    BEFORE INSERT ON member_period_balances
    FOR EACH ROW EXECUTE FUNCTION forbid_late_period_rollup_insert();

-- ---------------------------------------------------------------------------
-- 4. RLS (ADR-0002; forced, the 0001 policy shape)
-- ---------------------------------------------------------------------------
ALTER TABLE account_period_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_period_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON account_period_balances
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

ALTER TABLE member_period_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_period_balances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON member_period_balances
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
"""

_DOWN = """
-- Conditional refusal (0017/0020 precedent): rollup rows are the
-- closed-period money totals the trial balance serves; never silently
-- deleted.
DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM account_period_balances)
       OR EXISTS (SELECT 1 FROM member_period_balances) THEN
        RAISE EXCEPTION
            'downgrade refused: account_period_balances / '
            'member_period_balances hold closed-period money history; '
            'archive and delete it deliberately first (P13.17b / 0017 '
            'conditional-refusal precedent)';
    END IF;
END
$guard$;

DROP TRIGGER IF EXISTS member_period_balances_no_late_insert
    ON member_period_balances;
DROP TRIGGER IF EXISTS account_period_balances_no_late_insert
    ON account_period_balances;
DROP FUNCTION IF EXISTS forbid_late_period_rollup_insert();
DROP TRIGGER IF EXISTS member_period_balances_write_once
    ON member_period_balances;
DROP TRIGGER IF EXISTS account_period_balances_write_once
    ON account_period_balances;
DROP FUNCTION IF EXISTS forbid_period_rollup_mutation();
DROP TABLE IF EXISTS member_period_balances;
DROP TABLE IF EXISTS account_period_balances;
DROP TRIGGER IF EXISTS accounting_periods_rollup_marker_write_once
    ON accounting_periods;
DROP FUNCTION IF EXISTS forbid_rollup_marker_clear();
ALTER TABLE accounting_periods DROP COLUMN rollup_at;
"""


def upgrade() -> None:
    op.execute(_UP)


def downgrade() -> None:
    op.execute(_DOWN)
