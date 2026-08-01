<!--
  P-DIAG.5 — Sequence 3/3: the OUTBOX DISPATCH pattern (as-built)
  Authored against main @ 08541b860f1445b16c342c39b6606d86b9dbeb17
  Drift rule: v1.2 rule 11 — any MR that changes the enqueue contract,
  the claim/lease shape, the backoff/dead-letter policy or the
  no-domain-locks rule MUST update this file in the same MR. P13.17
  (DSA-6) and P20 are the named incoming changes; they flip the
  PLANNED notes below in their own MRs.
  Lock authority: the claim is the lock-order.md §3 outbox_events
  single-node locker row ("dispatch holds NO domain locks") — cited,
  never restated.
-->

# Sequence — outbox dispatch (P-DIAG.5, pattern 3)

The MASTER_PROMPT 1.2/1.4 contract as built: **the event commits with
the domain change; dispatch happens later, off-transaction, holding no
domain locks.**

```mermaid
sequenceDiagram
    autonumber
    participant SVC as any application service<br/>(mutation transaction)
    participant PG as Postgres — outbox_events<br/>(partial index idx_outbox_pending, 0001 L286)
    participant W as outbox worker<br/>infrastructure/outbox_worker.py run_worker L182
    participant P as provider adapter<br/>infrastructure/providers.py (StubProvider until P20)

    rect rgb(240,248,255)
    Note over SVC,PG: Phase 0 — same-transaction event write
    SVC->>PG: domain writes + application/outbox.py enqueue_event L17<br/>INSERT INTO outbox_events — SAME transaction
    Note over SVC,PG: rollback removes the event with the domain change<br/>(P5 atomicity test); direct provider calls from handlers<br/>are forbidden by import-linter contract 3
    end

    loop every interval, per active tenant (active_tenant_ids(), 0003)
        rect rgb(255,250,240)
        Note over W,PG: Phase 1 — claim (short txn, outbox rows ONLY)
        W->>PG: SELECT ... WHERE status = 'pending' AND next_attempt_at <= now()<br/>ORDER BY next_attempt_at LIMIT batch FOR UPDATE SKIP LOCKED<br/>(dispatch_due L48; served by the partial index)
        W->>PG: lease each claimed row: UPDATE next_attempt_at =<br/>now() + 300s (CLAIM_LEASE_SECONDS L28)
        W->>PG: COMMIT — claim txn ends BEFORE any provider call
        Note over W,PG: concurrent workers claim disjoint sets (SKIP LOCKED);<br/>a crashed worker's lease expires and the rows are re-claimed.<br/>PLANNED (P13.17/DSA-6): set-based lease UPDATE +<br/>dispatched-row retention purge — as-built leases per row
        end
        rect rgb(240,255,240)
        Note over W,P: Phase 2 — dispatch OUTSIDE any transaction
        W->>P: provider.send(event_id, event_type, payload)
        Note over W,P: NO domain locks, NO outbox locks held<br/>(lock-order.md §3, outbox row); adapters idempotent<br/>by event id, so redelivery never double-sends
        end
        rect rgb(255,240,240)
        Note over W,PG: Phase 3 — record outcome (fresh short txn per event)
        alt provider succeeded
            W->>PG: UPDATE status = 'dispatched', dispatched_at, attempts
        else provider raised
            W->>PG: _record_failure L109: attempts + 1, last_error,<br/>next_attempt_at = now() + backoff_delay(attempts, jitter) L31<br/>(exponential: 30s * 2^attempts, jitter 0.5x-1.0x)
            opt attempts >= MAX_ATTEMPTS (8, L26)
                W->>PG: UPDATE status = 'dead' (dead-letter; alertable via<br/>outbox_metrics L138)
            end
        end
        end
    end
```

## Code citations (valid at `08541b8`)

| Element | Source |
|---|---|
| Same-transaction write | `genesis/application/outbox.py:enqueue_event` L17 — called inside every mutating application-service transaction; atomicity proven by the P5 rollback test |
| No direct provider calls from handlers | `backend/pyproject.toml` import-linter contract 3 (api forbidden from `providers`/`outbox_worker`/`export_worker`) |
| Partial index | `idx_outbox_pending ON outbox_events (next_attempt_at) WHERE status = 'pending'` — migration `0001` L286 |
| Claim + lease | `genesis/infrastructure/outbox_worker.py:dispatch_due` L48 — `FOR UPDATE SKIP LOCKED` batch, per-row lease UPDATE (`CLAIM_LEASE_SECONDS = 300` L28), commit before dispatch |
| Dispatch holds no domain locks | claim txn touches ONLY `outbox_events` and is committed before `provider.send`; recorded in [`lock-order.md`](lock-order.md) §3 (outbox single-node locker row) |
| Idempotent adapters | `genesis/infrastructure/providers.py` — `NotificationProvider` contract + `StubProvider` (dedup by event id); real providers PLANNED (P20) |
| Backoff / dead-letter | `backoff_delay` L31 (exponential + jitter), `_record_failure` L109, `MAX_ATTEMPTS = 8` L26 → `status = 'dead'` |
| Worker loop / tenant walk | `run_worker` L182 → `run_dispatch_cycle` L173 → `list_active_tenants` L164 (`active_tenant_ids()` SECURITY DEFINER, migration `0003`) |
| PLANNED deltas | P13.17 (DSA-6): set-based lease UPDATE, retention purge, due-tenant discovery; P20: real SMS/email/push adapters, per-channel circuit breakers |
