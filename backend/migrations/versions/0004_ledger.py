"""ledger: balanced DR/CR trigger, append-only trigger, txn_ref sequence table

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-28

Gates satisfied:
  1.4 — pg_advisory_xact_lock + UNIQUE + retry for reference generation
  1.5 — balanced DR/CR enforced by trigger; UPDATE/DELETE blocked by trigger
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

_UP = """
-- -------------------------------------------------------------------------
-- txn_ref_sequences: per-tenant, per-prefix monotonic counter used by the
-- application service to generate race-safe references via
-- pg_advisory_xact_lock (gate 1.4).
-- -------------------------------------------------------------------------
CREATE TABLE txn_ref_sequences (
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    prefix    text NOT NULL,
    last_val  bigint NOT NULL DEFAULT 0 CHECK (last_val >= 0),
    PRIMARY KEY (tenant_id, prefix)
);

ALTER TABLE txn_ref_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE txn_ref_sequences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON txn_ref_sequences
    USING (tenant_id = current_setting('app.tenant_id')::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

-- -------------------------------------------------------------------------
-- Trigger: ledger_entries is append-only (gate 1.5)
-- UPDATE and DELETE are blocked; corrections must be reversing entries.
-- -------------------------------------------------------------------------
CREATE FUNCTION ledger_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION
        'ledger_entries is append-only (MASTER_PROMPT gate 1.5): '
        'use a reversing entry to correct a posting';
END
$fn$;

CREATE TRIGGER ledger_entries_no_update
    BEFORE UPDATE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

CREATE TRIGGER ledger_entries_no_delete
    BEFORE DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_append_only();

-- -------------------------------------------------------------------------
-- Trigger: transactions is append-only (gate 1.5)
-- -------------------------------------------------------------------------
CREATE TRIGGER transactions_no_update
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();

CREATE TRIGGER transactions_no_delete
    BEFORE DELETE ON transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_row_mutation();

-- -------------------------------------------------------------------------
-- Trigger: balanced DR/CR enforced per transaction (gate 1.5)
--
-- Fires AFTER INSERT on ledger_entries (deferred to statement level so all
-- lines for one transaction are visible together).  Checks that for every
-- transaction_id touched in this statement the sum of debit amounts equals
-- the sum of credit amounts.
-- -------------------------------------------------------------------------
CREATE FUNCTION check_ledger_balanced() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN
        SELECT
            transaction_id,
            SUM(CASE WHEN side = 'debit'  THEN amount ELSE 0 END) AS dr,
            SUM(CASE WHEN side = 'credit' THEN amount ELSE 0 END) AS cr
        FROM ledger_entries
        WHERE transaction_id = ANY(
            SELECT DISTINCT transaction_id FROM new_table
        )
        GROUP BY transaction_id
    LOOP
        IF rec.dr <> rec.cr THEN
            RAISE EXCEPTION
                'Unbalanced ledger for transaction %: DR=% CR=%',
                rec.transaction_id, rec.dr, rec.cr;
        END IF;
    END LOOP;
    RETURN NULL;
END
$fn$;

-- AFTER INSERT ... REFERENCING NEW TABLE allows set-level balance check.
CREATE TRIGGER ledger_entries_balanced
    AFTER INSERT ON ledger_entries
    REFERENCING NEW TABLE AS new_table
    FOR EACH STATEMENT EXECUTE FUNCTION check_ledger_balanced();
"""

_DOWN = """
DROP TRIGGER IF EXISTS ledger_entries_balanced   ON ledger_entries;
DROP TRIGGER IF EXISTS ledger_entries_no_update  ON ledger_entries;
DROP TRIGGER IF EXISTS ledger_entries_no_delete  ON ledger_entries;
DROP TRIGGER IF EXISTS transactions_no_update    ON transactions;
DROP TRIGGER IF EXISTS transactions_no_delete    ON transactions;
DROP FUNCTION IF EXISTS check_ledger_balanced();
DROP FUNCTION IF EXISTS ledger_append_only();
DROP TABLE IF EXISTS txn_ref_sequences CASCADE;
"""


def upgrade() -> None:
    op.execute(_UP)


def downgrade() -> None:
    op.execute(_DOWN)
