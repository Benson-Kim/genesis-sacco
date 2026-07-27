# Genesis Prestige — Admin Web

Next.js + TypeScript admin console, scaffolded per `docs/MASTER_PROMPT.md`
§2.3 / `docs/BUILD_PROMPTS.md` P14. npm workspaces:

```
web/
  apps/admin/            Next.js app (App Router), TS strict
  packages/tokens/        Design tokens extracted verbatim from
                           genesis_prestige_app.html's :root CSS variables
  packages/ui/             Design-system components + the generic
                           keyset-pagination CursorTable (gate 1.3)
  packages/api-client/    OpenAPI-generated types, Zod-validated,
                           TanStack-Query-friendly client functions
```

## Setup

```bash
cd web
npm install
npm run generate:client   # regenerates packages/api-client/src/generated
npm run lint
npm run typecheck
npm test
npm run build
```

Set `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_TENANT_ID` in
`apps/admin/.env.local` for local dev against a running `backend/`.

## Known scaffold gaps (read before merging)

This scaffold was built in a sandboxed environment with **no network
access**, so two things could not actually be executed and need a pass with
network access before this is CI-green:

1. **No `package-lock.json`.** `npm ci` (used by every `web:*` CI job) needs
   one. Run `npm install` once from `web/` with network access; commit the
   resulting lockfile.
2. **The generated client is hand-written, not tool-generated.**
   `packages/api-client/src/generated/schema.ts` was authored by hand to
   match `openapi.json` field-for-field (and is marked as such in its
   header) because `openapi-typescript` could not be installed or run here.
   Run `npm run generate:client` — ideally with `OPENAPI_URL` pointed at a
   running `backend/` instance — to replace it with the tool's real output.
   The diff should be near-zero if the hand-written version is accurate;
   `web:client-drift` in `.gitlab-ci.yml` enforces this going forward.

Everything else (design tokens, UI primitives, the cursor-pagination
table/hook, the RBAC route guard, the OTP login flow, the working Access
Control page against the real `/access/roles` endpoint) is real,
hand-verified-for-consistency code — just never run through an actual
`tsc`/`eslint`/`vitest` binary in this environment. Please run the commands
above and fix anything a real toolchain surfaces; I did not have a way to
self-check that here.

## Members / Loan book / Ledger pages

These three pages already use the shared `CursorTable` /
`useCursorPagination` (gate 1.3: keyset pagination, hard-capped at 100 rows
per page) and are route-guarded per `/me/permissions`. Their fetch functions
(`apps/admin/src/hooks/use-members.ts`, `use-loan-book.ts`, `use-ledger.ts`)
intentionally throw right now and are disabled (`enabled: false`) because
the backend doesn't expose `GET /members`, `/loans`, or `/ledger` yet
(`docs/BUILD_PROMPTS.md` P8/P10/P11). Once those land: regenerate the
client, replace the `throw` with a real call, flip `enabled: true`. No
table or pagination code needs to change.
