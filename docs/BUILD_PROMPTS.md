# GENESIS PRESTIGE — SEQUENTIAL BUILD PROMPTS (P0–P24)

Execute strictly in order. A prompt may start only when every prompt it
depends on has met its EXIT criteria. Every prompt inherits the whole of
`docs/MASTER_PROMPT.md`; gate references (1.1–1.6) are merge blockers.
Each prompt = one branch, atomic commits, one MR, pipeline fully green.
Agent commits carry `Duo-Workflow-Definition: ci_expert_agent/v1`.

Prompt format: ROLE / DEPENDS / PROMPT (give verbatim to the executor) / EXIT.

---

## PHASE A — FOUNDATION

### P0 — Governance merge & repo hygiene
ROLE: Solutions Architect. DEPENDS: none.
PROMPT: Merge MR !1. Then add: `.gitlab/merge_request_templates/Default.md`
containing the Definition of Done checklist (MASTER_PROMPT §5) with EXPLAIN
and rollback-plan fields; `CODEOWNERS` requiring architect review on
`docs/`, `.gitlab-ci.yml`, and `backend/src/domain/`. Configure branch
protection on `main`: merge only via MR with green pipeline.
EXIT: !1 merged; protections active; MR template appears on new MRs.

### P1 — Backend scaffold (issue #1)
ROLE: Developer. DEPENDS: P0.
PROMPT: Create `backend/` FastAPI skeleton per MASTER_PROMPT §2.1: packages
`src/api`, `src/application`, `src/domain`, `src/infrastructure`; enforce
inward dependency direction with import-linter in CI. Add `pyproject.toml`
(ruff strict, mypy --strict, pytest, coverage ≥85) so `backend:*` CI jobs
activate. Implement `/healthz`, `/readyz` (checks DB+Redis), structured JSON
logging with correlation IDs and a PII-scrubbing filter (1.6), env-only
settings, and the global error envelope: `{category, correlation_id}` —
never stack traces (1.2, 1.6).
EXIT: pipeline green with backend jobs running; /readyz verified against
compose services; import-linter blocks a deliberate violation in a test.

### P2 — Database schema v1 + tenancy (issue #2)
ROLE: Developer + DBA. DEPENDS: P1.
PROMPT: Implement all MASTER_PROMPT §2.2 tables via Alembic. Every
tenant-owned table: non-null `tenant_id`, RLS policy on
`current_setting('app.tenant_id')`, app role without BYPASSRLS (ADR-0002).
DB-level CHECKs (amounts ≥ 0, rate/term bounds), tenant-scoped UNIQUEs
(member_no, txn_ref), NOT NULL default, explicit ON DELETE, `version`
columns on editable aggregates (1.4), NUMERIC(18,2) money, composite
indexes leading with tenant_id, every FK indexed (1.3, 1.5). Add tenancy
middleware issuing `SET LOCAL app.tenant_id` per request transaction.
Write the cross-tenant leakage suite: for every table, prove tenant B
cannot read/write tenant A rows even with raw SQL through the app role.
EXIT: `backend:migrate-check` green (upgrade/downgrade/upgrade); leakage
suite green and marked release-blocking.

### P3 — Authentication (issue #3)
ROLE: Developer + Security Analyst. DEPENDS: P2.
PROMPT: Implement OTP step-up auth mirroring the prototype gate: 6 digits,
≤5 attempts, 5-min TTL, single-use, constant-time compare, delivery via
outbox stub. JWT access ≤15 min + rotating refresh with family-revocation
on reuse. Rate-limit auth endpoints. Add `Idempotency-Key` middleware
(request-hash + stored response, replay returns stored response) (1.4).
Adversarial tests: brute-force lockout, refresh reuse, concurrent identical
idempotency keys resolving to exactly one effect.
EXIT: all adversarial tests green; Security Analyst sign-off note on the MR.

### P4 — RBAC (issue #4)
ROLE: Developer. DEPENDS: P3.
PROMPT: Seed the 7-role permission matrix from the prototype `seedPerms()`
(System Admin, Branch Manager, Loan Officer, Teller, Credit Committee,
Accountant, Auditor × modules × view/create/edit/approve). Enforce
deny-by-default via a FastAPI dependency required on every router (1.6);
CI test walks the OpenAPI spec and fails if any operation lacks the authz
dependency. Expose `/me/permissions`. Audit-log permission changes (1.5).
Matrix-driven tests: every endpoint × every role.
EXIT: spec-walk test green; matrix tests green.

### P5 — Transactional outbox (issue #5)
ROLE: Developer. DEPENDS: P2.
PROMPT: Implement `core/outbox`: `outbox_events` written in the same
transaction as domain changes; worker (Celery or arq per ADR-0001) with
exponential backoff + jitter, dead-letter table after N attempts, lag and
failure metrics. Dispatch must hold no domain row locks (1.4). Prove
atomicity: rollback removes the event. Provider adapters (email/SMS/push)
behind interfaces, idempotent by event id (1.2).
EXIT: atomicity, retry-then-success, and dead-letter tests green; a
request-handler direct-provider-call lint rule active in CI.

### P6 — Lending domain engine (issue #6)
ROLE: Developer + QE. DEPENDS: P1 (pure domain; parallel with P2–P5 allowed).
PROMPT: Implement `domain/lending`: reducing-balance amortization
(Decimal-only, documented rounding, Hypothesis property tests on the
sum-of-installments invariant), schedule generation, classification
(Normal ≤30d/1%, Watch ≤90d/5%, Substandard ≤180d/25% NPL, Doubtful
≤360d/50% NPL, Loss >360d/100% NPL), provisioning, and the application
stage machine (Submitted→Appraisal→Committee→Approved→Disbursed, plus
Rejected) where illegal transitions raise (1.4). Zero I/O in this package;
100% branch coverage.
EXIT: property tests + full-matrix transition tests green; coverage 100%
on the package.

### P7 — Double-entry ledger (issue #7)
ROLE: Developer + DBA. DEPENDS: P2, P5, P6.
PROMPT: Implement `ledger_entries` and posting services for Deposit,
Disbursement, Loan repayment, Share top-up, Withdrawal, Interest posting
across channels M-Pesa/Bank/Accrual. Balanced DR/CR enforced by trigger;
UPDATE/DELETE blocked by trigger; corrections are reversing entries (1.5).
Reference generation (MP-/LN-/RP-/SH-/WD-/INT-) via
`pg_advisory_xact_lock` + UNIQUE + retry (1.4). Disbursement is one atomic
application-service transaction: approval check + posting + schedule +
outbox (1.5). Audit-log all postings. Concurrency test: 50 parallel posts,
zero gaps or duplicates.
EXIT: trigger, reversal, and concurrency tests green.

---

## PHASE B — DOMAIN FEATURES (API)

### P8 — Members module
ROLE: Developer. DEPENDS: P4, P7.
PROMPT: Implement members CRUD for types person|company|group|vehicle with
the prototype's add-member flow fields; race-safe `GP-XXXX` numbering
(advisory lock + UNIQUE + retry, 1.4); optimistic-locked edits returning
409 on stale version; share and deposit accounts opened atomically with the
member; member statement endpoint (keyset-paginated, mirrors prototype
statement rows); status transitions Active↔Arrears→Exited via the
transition function (1.4). Audit + outbox welcome notification (1.5, 1.2).
EXIT: N+1 query-count assertions on list endpoints; double-submit creates
exactly one member; 409 test green.

### P9 — Loan applications, committee, guarantors
ROLE: Developer. DEPENDS: P8.
PROMPT: Implement loan products (rate, deposit multiplier, max term),
applications with cover% computation (deposits+guarantees vs amount ×
product rules), the P6 stage machine under SELECT…FOR UPDATE, committee
voting (quorum → Approved/Rejected, one vote per member enforced by
UNIQUE), and guarantorship: pledge creation with available-capacity check
(deposits minus existing pledges) computed under lock to prevent
over-pledging (1.4); guarantor consent recorded; release on full repayment.
All mutations audit-logged; decisions notified via outbox.
EXIT: concurrent over-pledge test proves capacity never exceeded; stage
machine adversarial tests green.

### P10 — Loan servicing & portfolio
ROLE: Developer. DEPENDS: P9.
PROMPT: Implement disbursement (P7 atomic contract), repayment allocation
(penalties→interest→principal, documented), nightly arrears job computing
days-past-due → classification → provisioning per tenant in batches (no
long transactions, 1.3), loan book endpoints with classification pills and
NPL/PAR-30 portfolio summaries feeding the dashboard, and early settlement
quotes. Guarantee release hook on closure.
EXIT: golden-file schedule tests; arrears job idempotent (re-run changes
nothing); dashboard aggregates match seeded fixtures to the cent.

### P11 — Transactions & interest
ROLE: Developer. DEPENDS: P8, P7.
PROMPT: Implement deposits, withdrawals (balance check under row lock, no
blocking I/O while held, 1.3/1.4), share top-ups, and the quarterly
deposit-interest accrual job (batch, idempotent by period UNIQUE, posts
INT- refs via P7). Ledger listing endpoint with keyset pagination and
filters matching the prototype columns (date, ref, member, type, DR/CR,
channel).
EXIT: concurrent withdrawal test never overdraws; interest job re-run
posts nothing new.

### P12 — Member exit & settlement
ROLE: Developer. DEPENDS: P10, P11.
PROMPT: Implement exit workflow per prototype: eligibility check (no active
loan unless netted; active guarantees block exit until released/substituted),
settlement computation (shares + deposits − loan balance − fees), committee
approval step, atomic settlement posting via P7, terminal state transition.
Exit statement document via export path.
EXIT: guarantee-blocked exit test green; settlement is atomic (kill-switch
test leaves no partial state).

### P13 — Reports & exports
ROLE: Developer. DEPENDS: P10, P11.
PROMPT: Implement `run_export(query, batch_size)` in `core/exports`:
fetch batch_size+1 for truncation detection, stream batches off the event
loop, set `X-Export-Truncated`/`X-Export-Limit`, enforce row caps (1.3).
Build reports: member statements, trial balance, loan book with
classification/provisions, disbursement & collections, NPL trend (monthly
series as in prototype bars). CSV + PDF rendered in worker via outbox jobs.
EXIT: truncation-header tests green; event-loop blocking test (export while
serving latency-checked requests) passes.

---

## PHASE C — CLIENTS

### P14 — Web admin scaffold (issue #8)
ROLE: Developer (Frontend). DEPENDS: P4.
PROMPT: Scaffold `web/` per MASTER_PROMPT §2.3: Next.js + TS strict,
zero-warning eslint, design-system package with tokens extracted verbatim
from prototype CSS variables, OpenAPI-generated client (regeneration script
in CI drift-check), TanStack Query + Zod, auth/OTP flow, route guards from
`/me/permissions`, keyset-pagination table component.
EXIT: `web:*` CI jobs green; client-drift check fails on stale client.

### P15 — Web admin features
ROLE: Developer (Frontend) + QE. DEPENDS: P14 + each corresponding API
prompt (build module-by-module in this order):
Dashboard (P10) → Members (P8) → Applications+Committee (P9) → Loan book
(P10) → Guarantors (P9) → Transactions (P11) → Member exit (P12) →
Reports (P13) → Settings/products (P9) → Access control (P4).
PROMPT: Reproduce the prototype screens with real data; optimistic-lock 409
handling as inline conflict banners; idempotency keys on all mutations;
no PII in client analytics (1.6). Playwright E2E per module happy path plus
one adversarial flow (stale edit, forbidden role).
EXIT: all ten modules E2E-green; Lighthouse perf budget documented.

### P16 — Flutter workspace (issue #9)
ROLE: Developer (Mobile). DEPENDS: P4.
PROMPT: Scaffold `mobile/` per MASTER_PROMPT §2.4: `member_app`,
`admin_app`, shared `gp_ui` (prototype palette tokens) and generated
`gp_api_client`; Riverpod; secure token storage; certificate pinning;
biometric step-up; offline read cache. `mobile:*` CI jobs green.
EXIT: both apps boot to authenticated shell against staging API.

### P17 — Member app features
ROLE: Developer (Mobile) + QE. DEPENDS: P16, P8–P13, P19 for payments.
PROMPT: Build: onboarding + OTP; balances (shares/deposits/loan);
statements (cursor-paginated, offline-cached); deposit via M-Pesa STK with
pending-intent status polling; loan application with product rules and
live installment preview (values from API, never local math — 1.1);
guarantor consent inbox; repayments; notifications. integration_test per
flow including airplane-mode statement read and double-tap submit
(exactly-one-effect).
EXIT: all flows integration-test green on Android + iOS CI matrix.

### P18 — Admin mobile app features
ROLE: Developer (Mobile). DEPENDS: P16, P8–P12.
PROMPT: Build the field-officer subset: member lookup + onboarding,
application capture, committee vote (biometric step-up), arrears worklist,
txn capture. Same gates as P17.
EXIT: flows integration-test green; RBAC verified per role on-device.

---

## PHASE D — INTEGRATIONS & LAUNCH

### P19 — M-Pesa (issue #10)
ROLE: Developer + Security Analyst. DEPENDS: P11.
PROMPT: Write ADR + threat model first (sign-off required). Implement STK
push against stored payment intents; source-verified, intent-validated,
idempotent callbacks (duplicate → one posting); posting + notification via
outbox in one transaction; daily reconciliation job that alerts on mismatch
and never auto-mutates the ledger; callback rate limiting; secrets via
CI/CD variables only. Adversarial tests: replayed, forged, out-of-order,
timeout-then-success callbacks.
EXIT: sandbox end-to-end deposit reflected in ledger and member statement;
all adversarial tests green.

### P20 — Notifications
ROLE: Developer. DEPENDS: P5, P8–P12.
PROMPT: Wire real SMS/email/push providers behind the P5 adapters with
per-tenant templates and per-channel circuit breakers; delivery-status
writeback; member notification preferences. All sends outbox-only (1.2);
no PII beyond the minimum in payloads (1.6).
EXIT: provider-outage chaos test: actions succeed, events dead-letter and
replay cleanly.

### P21 — Observability & performance
ROLE: QE + Developer. DEPENDS: Phase B complete.
PROMPT: Add OpenTelemetry traces/metrics/logs (PII-scrubbed), dashboards
(p95 latency, error rate by category, outbox lag, job durations), alerts.
Load tests (k6): 10k-member tenant, 50 concurrent tellers; verify keyset
pagination flatness and zero lock-wait timeouts; capture EXPLAIN for the
top 20 queries into `docs/perf/`.
EXIT: p95 < 300ms on hot reads, < 800ms on posting writes at target load;
alerts fire in a game-day drill.

### P22 — Deployment & environments
ROLE: CI/CD Engineer. DEPENDS: P21.
PROMPT: Extend the pipeline with deploy-review (per-MR review apps +
DAST), deploy-staging (auto on main), deploy-prod (manual, protected
environment). Container scanning on built images; SBOM artifact. Managed
Postgres with PITR backups; documented + rehearsed restore (DR drill);
zero-downtime migration policy (expand→migrate→contract) enforced by MR
template checkbox. Store demo/live app distribution (Flutter) via CI.
EXIT: full promote path exercised; restore drill documented under 30 min.

### P23 — Security hardening & tenant onboarding
ROLE: Security Analyst. DEPENDS: P22.
PROMPT: Run full DAST against staging; triage every scanner finding
(critical=block). Verify: RLS leakage suite, rate limits, secret scanning
clean, dependency review, audit-log completeness sampling, log PII audit.
Build tenant onboarding runbook: tenant record, admin bootstrap, product
config, M-Pesa credentials via secret manager, RBAC seed. Data protection
(Kenya DPA) checklist: retention, subject access export via P13, breach
playbook.
EXIT: zero open critical/high findings; onboarding runbook executed
successfully for a pilot tenant on staging.

### P24 — UAT & launch
ROLE: Product Manager + QE. DEPENDS: P23.
PROMPT: Script UAT against every prototype screen/behavior as acceptance
cases (dashboard figures, classification pills, committee flow, exit
settlement, statements, RBAC per role). Pilot tenant runs 2 weeks on
staging with real workflows; defects triaged daily, fixes follow the full
gate process (no shortcuts). Launch checklist: alerts on, on-call rota,
rollback plan rehearsed, support runbook.
EXIT: UAT sign-off; production tenant live; week-one error budget intact.

---

## STANDING RULE
If any prompt's EXIT cannot be met, stop, record the blocker as an issue
referencing the prompt ID, and do not start dependent prompts. Never
weaken a gate to pass an EXIT.
