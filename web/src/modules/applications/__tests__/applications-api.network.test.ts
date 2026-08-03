/**
 * @jest-environment node
 *
 * Network-layer proofs for the applications/committee API layer through
 * the REAL generated client + middleware (node environment: real
 * Request/Response/Headers; fetch stubbed at the network boundary),
 * mirroring the settings-api reference harness:
 * - Bearer/tenant/Idempotency-Key travel as HEADERS; nothing secret
 *   ever enters a URL.
 * - Keyset pagination ONLY: the opaque cursor is echoed back verbatim
 *   as a query parameter; no offset/page parameter exists (gate 1.3).
 * - Money travels as decimal STRINGS byte-identically in JSON bodies
 *   (blocker (a)) — never re-encoded as numbers.
 * - Optimistic-lock versions ride in transition bodies; a 409 surfaces
 *   as a typed ApiError from ONE request (no transport-level retry).
 */

// Module scope (the users reference harness stays a global script; two
// scripts would collide on shared global declarations under tsc).
export {};

type FetchCall = { url: string; method: string; headers: Headers; body: string | null };

const TENANT = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const MEMBER_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "44444444-4444-4444-4444-444444444444";
const APP_ID = "aaaaaaaa-1111-2222-3333-444444444444";

const calls: FetchCall[] = [];
let transitionStatus = 200;

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(sub: string, expInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expInSeconds;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

const applicationOut = {
  id: APP_ID,
  member_id: MEMBER_ID,
  product_id: PRODUCT_ID,
  amount: "250000.10",
  term_months: 24,
  rate_pct: "12.50",
  purpose: "School fees",
  stage: "submitted",
  cover_pct: "120.00",
  max_eligible: "300000.00",
  version: 3,
};

const voteResultOut = { approvals: 2, rejections: 1, decision: null, stage: "committee" };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function fetchStub(input: Request | string | URL, init?: RequestInit): Promise<Response> {
  const request = input instanceof Request ? input : new Request(input, init);
  const body = request.method === "GET" ? null : await request.clone().text();
  calls.push({ url: request.url, method: request.method, headers: request.headers, body });
  const path = new URL(request.url).pathname;
  if (request.headers.get("authorization") === null) {
    return json(401, { category: "unauthenticated", correlation_id: "corr-a" });
  }
  if (path === "/applications" && request.method === "GET") {
    return json(200, { items: [applicationOut], next_cursor: "cursor-page-2" });
  }
  if (path === "/applications" && request.method === "POST") {
    return json(201, applicationOut);
  }
  if (path === `/applications/${APP_ID}` && request.method === "GET") {
    return json(200, applicationOut);
  }
  if (path === `/applications/${APP_ID}/transition` && request.method === "POST") {
    if (transitionStatus !== 200) {
      return json(transitionStatus, { category: "conflict", correlation_id: "corr-c" });
    }
    return json(200, { ...applicationOut, stage: "appraisal", version: 4 });
  }
  if (path === `/applications/${APP_ID}/vote` && request.method === "POST") {
    return json(200, voteResultOut);
  }
  return json(404, { category: "not_found", correlation_id: "corr-n" });
}

// The generated client captures globalThis.fetch at creation time, so the
// stub must be installed BEFORE the modules under test are imported.
globalThis.fetch = fetchStub as typeof globalThis.fetch;

// Tenant scope is build-time configuration (src/lib/env reads
// NEXT_PUBLIC_TENANT_ID at module load) — set BEFORE requiring modules.
process.env.NEXT_PUBLIC_TENANT_ID = TENANT;

// Node has no window: back the single per-tab custody site with a Map
// (the real storage read/write path still runs) — reference-harness model.
const tabStorage = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  sessionStorage: {
    getItem: (key: string): string | null => tabStorage.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      tabStorage.set(key, String(value));
    },
    removeItem: (key: string): void => {
      tabStorage.delete(key);
    },
    clear: (): void => {
      tabStorage.clear();
    },
    get length(): number {
      return tabStorage.size;
    },
  },
};

/* eslint-disable @typescript-eslint/no-require-imports */
const session = require("@/modules/auth/session") as typeof import("@/modules/auth/session");
const appsApi = require("../api") as typeof import("../api");
const { ApiError } = require("@genesis/api-client") as typeof import("@genesis/api-client");
/* eslint-enable @typescript-eslint/no-require-imports */

const REFRESH_VALUE = "per-tab-refresh-value";

beforeEach(() => {
  calls.length = 0;
  transitionStatus = 200;
  session.clearSession();
  session.setSession({ accessToken: jwt(USER_ID, 900), refreshToken: REFRESH_VALUE });
});

afterEach(() => {
  session.clearSession();
});

test("GET /applications: keyset params ONLY (stage/cursor/limit — no offset/page); the opaque cursor echoes back VERBATIM", async () => {
  await appsApi.fetchApplicationsPage({ stage: "committee" }, null);
  const page = await appsApi.fetchApplicationsPage({ stage: "committee" }, "cursor-page-2");
  expect(calls).toHaveLength(2);

  const first = new URL(calls[0]!.url);
  expect(first.pathname).toBe("/applications");
  expect(first.searchParams.get("stage")).toBe("committee");
  expect(first.searchParams.get("limit")).toBe(String(appsApi.APPLICATIONS_PAGE_SIZE));
  expect(first.searchParams.has("cursor")).toBe(false);
  expect(first.searchParams.has("offset")).toBe(false);
  expect(first.searchParams.has("page")).toBe(false);

  const second = new URL(calls[1]!.url);
  expect(second.searchParams.get("cursor")).toBe("cursor-page-2");
  expect(second.searchParams.has("offset")).toBe(false);

  // Bearer + tenant as headers; the refresh secret never enters a URL.
  expect(calls[0]!.headers.get("authorization")).toMatch(/^Bearer /);
  expect(calls[0]!.headers.get("x-tenant-id")).toBe(TENANT);
  expect(calls[0]!.url).not.toContain(REFRESH_VALUE);

  // The boundary transform yields the client-side page shape.
  expect(page.items[0]?.amount).toBe("250000.10");
  expect(page.nextCursor).toBe("cursor-page-2");
});

test("POST /applications: the amount travels as a decimal STRING byte-identically; idempotency as a header", async () => {
  await appsApi.createApplication(
    {
      member_id: MEMBER_ID,
      product_id: PRODUCT_ID,
      amount: "250000.10",
      term_months: 24,
      purpose: null,
    },
    "key-create-1",
  );
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.method).toBe("POST");
  expect(new URL(call.url).pathname).toBe("/applications");
  expect(call.headers.get("idempotency-key")).toBe("key-create-1");
  const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
  // String on the wire — falsifiable: coerce to Number and the trailing
  // ".10" collapses / the JSON type flips.
  expect(body["amount"]).toBe("250000.10");
  expect(body["term_months"]).toBe(24);
  expect(body["purpose"]).toBeNull();
});

test("POST /applications/{id}/transition: id rides the PATH, version rides the BODY; idempotency as a header", async () => {
  await appsApi.transitionApplication(
    APP_ID,
    { target: "appraisal", version: 3 },
    "key-move-1",
  );
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(new URL(call.url).pathname).toBe(`/applications/${APP_ID}/transition`);
  expect(new URL(call.url).search).toBe("");
  expect(call.headers.get("idempotency-key")).toBe("key-move-1");
  const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
  expect(body["target"]).toBe("appraisal");
  expect(body["version"]).toBe(3);
});

test("a stale transition surfaces as ONE 409 ApiError — no transport-level retry", async () => {
  transitionStatus = 409;
  const thrown = await appsApi
    .transitionApplication(APP_ID, { target: "committee", version: 2 }, "key-stale-1")
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ApiError);
  expect((thrown as InstanceType<typeof ApiError>).status).toBe(409);
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("POST /applications/{id}/vote: the body carries the vote only; the parsed tally is counts + decision", async () => {
  const result = await appsApi.voteOnApplication(APP_ID, "approve", "key-vote-1");
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(new URL(call.url).pathname).toBe(`/applications/${APP_ID}/vote`);
  expect(call.headers.get("idempotency-key")).toBe("key-vote-1");
  expect(JSON.parse(call.body ?? "{}")).toEqual({ vote: "approve" });
  expect(result).toEqual({ approvals: 2, rejections: 1, decision: null, stage: "committee" });
});

test("responses parse through the Zod boundary: record reads return validated shapes", async () => {
  const application = await appsApi.fetchApplication(APP_ID);
  expect(application.amount).toBe("250000.10");
  expect(application.stage).toBe("submitted");
  expect(application.version).toBe(3);
});
