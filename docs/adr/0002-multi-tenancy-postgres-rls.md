# ADR-0002: Multi-tenancy via shared schema + PostgreSQL Row-Level Security

- Status: Accepted
- Date: 2026-07-27
- Deciders: Genesis Prestige engineering

## Context
The platform serves many SACCOs (tenants). Isolation failures are catastrophic
(financial + PII data). MASTER_PROMPT 1.6 requires database-enforced isolation.

## Decision
Single database, single schema. Every tenant-owned table carries a non-null
`tenant_id`. RLS policies restrict all reads/writes to
`tenant_id = current_setting('app.tenant_id')::uuid`, set per request with
`SET LOCAL` inside the transaction by tenancy middleware. The application DB
role does NOT have `BYPASSRLS`. Unique constraints are tenant-scoped
(`UNIQUE (tenant_id, member_no)` etc.).

## Alternatives considered
- Schema-per-tenant — migration fan-out and connection-pool complexity grow
  linearly with tenants; rejected.
- Database-per-tenant — strongest isolation but operationally heavy and
  expensive at target tenant counts; revisit only if a regulator mandates it.
- App-layer filtering only — a single missed `WHERE tenant_id` leaks data;
  rejected outright.

## Consequences
- A cross-tenant leakage test suite (attempts to read/write another tenant's
  rows through every endpoint) is a permanent release blocker.
- All composite indexes lead with `tenant_id`.
- Admin/maintenance tasks needing cross-tenant access use a separate,
  audited role and never the application role.
