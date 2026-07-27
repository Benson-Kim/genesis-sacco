## What
<!-- What does this MR change? One paragraph. -->

## Why
<!-- Link the issue(s) and the BUILD_PROMPTS prompt ID (e.g. P8). -->

Closes #

## Definition of Done (MASTER_PROMPT §5 — all boxes required)

- [ ] **1.1 Reuse-first**: no duplication of existing modules/packages.
- [ ] **1.2 Reliability**: no silent failures; side-effects via transactional outbox only; analytics cannot break the action.
- [ ] **1.3 Scalability**: keyset pagination on lists; no N+1 (query-count test added); indexes shipped with the queries that need them; exports via `run_export` only.
- [ ] **1.4 Concurrency**: transitions via the transition function under lock; optimistic locking (409 on stale); `Idempotency-Key` honored; reference generation race-safe.
- [ ] **1.5 Data integrity**: DB constraints (CHECK/UNIQUE/FK/NOT NULL) not just app validation; audit trail written in-transaction; multi-step operations atomic.
- [ ] **1.6 Security**: endpoint authenticated + RBAC-authorized server-side; no PII in logs/analytics/errors; no literal secrets.
- [ ] **Tests**: unit + integration + the mandatory adversarial tests for this feature (double-submit, stale edit, cross-tenant access where applicable).
- [ ] **Contract**: OpenAPI updated; web/mobile clients regenerated (or N/A).
- [ ] **Migrations**: backward-compatible one release (expand → migrate → contract); downgrade smoke passes (or N/A).
- [ ] **Pipeline**: fully green including security stage.

## EXPLAIN output for new hot-path queries
<!-- Paste EXPLAIN (ANALYZE, BUFFERS) or write "N/A — no new hot-path queries". -->

```
N/A
```

## Rollback plan
<!-- How is this change reverted safely? Include data implications. -->
