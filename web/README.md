# Genesis Prestige — Admin Web (`web/`)

Next.js + TypeScript **strict** admin app (MASTER_PROMPT §2.3), built P14.
Scaffold only — feature screens land in P15.

## Module layout

```
web/
├── packages/
│   ├── design-system/     # @genesis/design-system — tokens (verbatim from the
│   │                      #   prototype :root CSS variables) + UI primitives.
│   │                      #   The ONLY source of colors/spacing (gate 1.1).
│   └── api-client/        # @genesis/api-client — typed client. Types are
│       ├── openapi.json   #   GENERATED from the backend OpenAPI contract;
│       └── src/generated/ #   never hand-written (MASTER_PROMPT §2.1).
├── src/
│   ├── app/               # Next.js app router (thin pages only)
│   ├── lib/               # env + the single authenticated API client
│   └── modules/
│       ├── auth/          # OTP flow, session store, token refresh, RequireAuth
│       ├── authz/         # /me/permissions guards (RequireModule, deny-by-default)
│       ├── layout/        # app shell: sidebar (permission-filtered nav), header
│       └── table/         # keyset-pagination table + cursor hooks (gate 1.3)
└── scripts/
    └── check-client-drift.sh
```

Internal packages are consumed through TypeScript path aliases
(`@genesis/design-system`, `@genesis/api-client`); views import primitives and
clients only through those public entry points.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | dev server |
| `npm run lint` | eslint, **zero warnings** (`--max-warnings 0`) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | jest (jsdom) |
| `npm run build` | production build |
| `npm run generate:api` | regenerate the client from `packages/api-client/openapi.json` |
| `npm run check:client-drift` | fail if the generated client is stale |

## API client regeneration & drift-check

The contract flows one way: backend code → OpenAPI → generated client.

1. `cd backend && python scripts/export_openapi.py ../web/packages/api-client/openapi.json`
2. `cd web && npm run generate:api`
3. Commit both outputs.

CI enforces both halves on every pipeline:

- **`web:spec-drift`** — re-exports the spec from backend code and diffs it
  against the committed `openapi.json` (fails when the backend contract moved).
- **`web:client-drift`** — regenerates the TypeScript client from the committed
  `openapi.json` and diffs it against `src/generated/` (fails on a stale client).

## Configuration

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | API origin (default `http://localhost:8000`) |
| `NEXT_PUBLIC_TENANT_ID` | tenant scope sent as `X-Tenant-Id` on pre-auth calls |

No secrets here — `NEXT_PUBLIC_*` values are public by definition (gate 1.6).

## Auth & session notes

- Access token (≤15 min JWT) is held in memory only; the rotating refresh
  token lives in `sessionStorage` (per-tab, cleared on close). Refresh is
  proactive and single-flight before expiry.
- Route guards (`RequireAuth`, `RequireModule`) consume `/me/permissions` and
  are deny-by-default; they shape UX only — the API authorizes every call.
- Mutations send an `Idempotency-Key` (one key per logical submission, gate 1.4).
- All list UIs use the keyset (cursor) contract `{items, next_cursor}` (gate 1.3).
