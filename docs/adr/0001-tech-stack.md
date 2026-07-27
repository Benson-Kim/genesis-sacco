# ADR-0001: Core technology stack

- Status: Accepted
- Date: 2026-07-27
- Deciders: Genesis Prestige engineering

## Context
Multi-tenant SACCO platform (MASTER_PROMPT section 0) needing strong relational
integrity, concurrency safety, mobile apps for members and admins, and an admin
web portal. Team direction: Flutter for mobile, a React framework for web,
Python for backend, a relational database.

## Decision
- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic v2.
- **Database**: PostgreSQL 16 — row-level security for tenancy, advisory locks,
  CHECK/UNIQUE/partial indexes, `NUMERIC` money.
- **Cache/queues**: Redis; background worker (Celery or arq) for outbox,
  exports, scheduled jobs.
- **Web**: Next.js with TypeScript strict, TanStack Query, Zod.
- **Mobile**: Flutter (Dart 3), Riverpod, two apps sharing packages.
- **Contract**: OpenAPI-first; web and mobile API clients are generated.

## Alternatives considered
- Django/DRF — mature, but weaker async story and less precise typing at the
  boundary than FastAPI + Pydantic for this API-first design.
- MySQL/MariaDB — no row-level security, weaker constraint/locking toolbox.
- React Native — rejected; Flutter chosen for single high-fidelity codebase.
- Vite SPA — rejected; Next.js gives routing, SSR, and asset discipline.

## Consequences
- One relational engine to master deeply; all tenancy and concurrency gates
  (MASTER_PROMPT 1.4-1.6) implementable at the database layer.
- Generated clients remove drift between backend and the three frontends.
- Team must maintain Alembic migration discipline (expand -> migrate -> contract).
