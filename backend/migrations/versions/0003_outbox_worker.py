"""outbox: last_error column and worker tenant registry

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-27
"""

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

_UP = """
ALTER TABLE outbox_events ADD COLUMN last_error text;

-- Worker tenant registry: SECURITY DEFINER so the dispatcher can enumerate
-- tenants without weakening RLS on any other table. The defining role is
-- the migration role (BYPASSRLS/superuser in CI and ops environments).
CREATE FUNCTION active_tenant_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $fn$ SELECT id FROM tenants WHERE status = 'active' $fn$;
"""

_DOWN = """
DROP FUNCTION IF EXISTS active_tenant_ids();
ALTER TABLE outbox_events DROP COLUMN IF EXISTS last_error;
"""


def upgrade() -> None:
    op.execute(_UP)


def downgrade() -> None:
    op.execute(_DOWN)
