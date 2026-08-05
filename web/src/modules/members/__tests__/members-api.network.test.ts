/**
 * @jest-environment node
 *
 * Network-layer proofs for the members API layer through the REAL
 * generated client + middleware (node environment: real Request/
 * Response/Headers; fetch stubbed at the network boundary), mirroring
 * the exits/users reference harnesses (issue #30 finding T1: members
 * had a mutating create flow with no wire-level proof).
 * - Bearer/tenant/Idempotency-Key travel as HEADERS; nothing secret
 *   ever enters a URL (gate 1.6).
 * - Keyset pagination ONLY: the opaque cursor is echoed back verbatim
 *   as a query parameter; no offset/page parameter exists (gate 1.3);
 *   status/type filters are server-side query parameters.
 * - The create body is asserted KEY-BY-KEY: {type, name, phone, email}
 *   and NOTHING else — no money, no member_no, no status can even be
 *   SENT (member numbering and account opening are server-owned,
 *   MemberCreateBody in api/members.py).
 * - A 422 surfaces field-level messages as a typed ApiError (canonical
 *   field keys, W56-5); a 409 (idempotency-key reuse with a different
 *   request hash / server conflict) surfaces from ONE request — no
 *   transport-level retry, no replay.
 * - Unknown enum vocabulary (status/type) is a contract violation and
 *   is REJECTED at the Zod boundary; extra response keys are STRIPPED.
 */

// Module scope (the users reference harness stays a global script; two
// scripts would collide on shared global declarations under tsc).
export {};

type FetchCall = { url: string; method: string; headers: Headers; body: string | null };

const TENANT = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const MEMBER_ID = "11111111-1111-1111-1111-111111111111";

const calls: FetchCall[] = [];
let createStatus = 201;
let listUnknownStatus = false;
let listUnknownType = false;
let detailWithoutAggregates = false;

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(sub: string, expInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expInSeconds;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

const memberOut = {
  id: MEMBER_ID,
  member_no: "GP-0001",
  type: "person",
  name: "Jane Wanjiku",
  phone: null,
  email: null,
  status: "active",
  version: 1,
};

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
  if (path === "/members" && request.method === "GET") {
    if (listUnknownStatus) {
      return json(200, { items: [{ ...memberOut, status: "suspended" }], next_cursor: null });
    }
    if (listUnknownType) {
      return json(200, { items: [{ ...memberOut, type: "trust" }], next_cursor: null });
    }
    return json(200, { items: [memberOut], next_cursor: "cursor-page-2" });
  }
  if (path === "/members" && request.method === "POST") {
    if (createStatus === 409) {
      return json(409, { category: "conflict", correlation_id: "corr-c" });
    }
    if (createStatus === 422) {
      // FastAPI validation body — the loc head is stripped to the
      // CANONICAL field key by toApiError (W56-5).
      return json(422, {
        detail: [{ loc: ["body", "email"], msg: "value is not a valid email address" }],
      });
    }
    return json(201, { ...memberOut, internal_account_seed: "LEDGER-SECRET" });
  }
  if (path === `/members/${MEMBER_ID}` && request.method === "GET") {
    return json(200, memberOut);
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
const membersApi = require("../api") as typeof import("../api");
const { ApiError } = require("@genesis/api-client") as typeof import("@genesis/api-client");
/* eslint-enable @typescript-eslint/no-require-imports */

const REFRESH_VALUE = "per-tab-refresh-value";
const EMPTY_FILTERS = { status: "", type: "" } as const;

beforeEach(() => {
  calls.length = 0;
  createStatus = 201;
  listUnknownStatus = false;
  listUnknownType = false;
  detailWithoutAggregates = false;
  session.clearSession();
  session.setSession({ accessToken: jwt(USER_ID, 900), refreshToken: REFRESH_VALUE });
});

afterEach(() => {
  session.clearSession();
});

test("GET /members: keyset params ONLY (no offset/page); the opaque cursor echoes back VERBATIM; empty filters send NOTHING", async () => {
  await membersApi.fetchMembersPage(EMPTY_FILTERS, null);
  const page = await membersApi.fetchMembersPage(EMPTY_FILTERS, "cursor-page-2");
  expect(calls).toHaveLength(2);

  const first = new URL(calls[0]!.url);
  expect(first.pathname).toBe("/members");
  expect(first.searchParams.get("limit")).toBe(String(membersApi.MEMBERS_PAGE_SIZE));
  expect(first.searchParams.has("cursor")).toBe(false);
  expect(first.searchParams.has("offset")).toBe(false);
  expect(first.searchParams.has("page")).toBe(false);
  expect(first.searchParams.has("status")).toBe(false);
  expect(first.searchParams.has("type")).toBe(false);

  const second = new URL(calls[1]!.url);
  expect(second.searchParams.get("cursor")).toBe("cursor-page-2");
  expect(second.searchParams.has("offset")).toBe(false);

  // Bearer + tenant as headers; the refresh secret never enters a URL.
  expect(calls[0]!.headers.get("authorization")).toMatch(/^Bearer /);
  expect(calls[0]!.headers.get("x-tenant-id")).toBe(TENANT);
  expect(calls[0]!.url).not.toContain(REFRESH_VALUE);

  // The page shape parses verbatim; the cursor stays opaque.
  expect(page.items[0]?.member_no).toBe("GP-0001");
  expect(page.nextCursor).toBe("cursor-page-2");
});

test("GET /members: status and type filters are SERVER-side query parameters", async () => {
  await membersApi.fetchMembersPage({ status: "arrears", type: "person" }, null);
  const url = new URL(calls[0]!.url);
  expect(url.searchParams.get("status")).toBe("arrears");
  expect(url.searchParams.get("type")).toBe("person");
  expect(url.searchParams.has("offset")).toBe(false);
  expect(url.searchParams.has("page")).toBe(false);
});

test("GET /members/{id}: the id travels as a PATH parameter with no query string", async () => {
  const member = await membersApi.fetchMember(MEMBER_ID);
  expect(calls).toHaveLength(1);
  const url = new URL(calls[0]!.url);
  expect(url.pathname).toBe(`/members/${MEMBER_ID}`);
  expect(url.search).toBe("");
  expect(member.member_no).toBe("GP-0001");
  expect(member.version).toBe(1);
  // The name-resolve projection strips the aggregates object entirely:
  // cross-module consumers can never accidentally render money.
  expect("aggregates" in member).toBe(false);
});

test("GET /members/{id} DETAIL: the aggregates object parses KEY-EXACT — the four decimal strings VERBATIM and nothing else; extra response keys are STRIPPED", async () => {
  const detail = await membersApi.fetchMemberDetail(MEMBER_ID);
  expect(calls).toHaveLength(1);
  const url = new URL(calls[0]!.url);
  expect(url.pathname).toBe(`/members/${MEMBER_ID}`);
  expect(url.search).toBe("");
  // Key-exactness: exactly the four contract fields (falsifiable: add
  // or drop a key in the schema and this fails).
  expect(Object.keys(detail.aggregates).sort()).toEqual([
    "deposits_total",
    "guarantees_pledged",
    "loans_outstanding",
    "shares_total",
  ]);
  // Decimal STRINGS, byte-identical to the wire (never numbers — no
  // client-side money math can even start from here).
  expect(detail.aggregates.deposits_total).toBe("1500.50");
  expect(detail.aggregates.shares_total).toBe("750.25");
  expect(detail.aggregates.loans_outstanding).toBe("2500.10");
  expect(detail.aggregates.guarantees_pledged).toBe("1000.40");
  // The stubbed internal field can never reach a screen (STRIPPED).
  expect("internal_ledger_hint" in detail).toBe(false);
});

test("GET /members/{id} DETAIL: a response MISSING the aggregates object is a contract violation and is REJECTED (required, not optional)", async () => {
  detailWithoutAggregates = true;
  const thrown = await membersApi.fetchMemberDetail(MEMBER_ID).catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(ApiError);
  expect(String(thrown)).toContain("aggregates");
});

test("POST /members (create flow): the body carries {type, name, phone, email} and NOTHING else; the Idempotency-Key travels as a HEADER; the write query string is EMPTY; EXTRA response keys are STRIPPED", async () => {
  const created = await membersApi.createMember(
    { type: "person", name: "Jane Wanjiku", phone: "+254700000001", email: null },
    "key-member-1",
  );
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.method).toBe("POST");
  expect(new URL(call.url).pathname).toBe("/members");
  expect(new URL(call.url).search).toBe("");
  expect(call.headers.get("idempotency-key")).toBe("key-member-1");
  const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
  expect(body["type"]).toBe("person");
  expect(body["name"]).toBe("Jane Wanjiku");
  expect(body["phone"]).toBe("+254700000001");
  expect(body["email"]).toBeNull();
  // Nothing beyond the MemberCreateBody contract can even be sent —
  // member_no generation, status and account opening are SERVER-owned
  // (falsifiable: add a key to the API layer and this fails).
  expect(Object.keys(body).sort()).toEqual(["email", "name", "phone", "type"]);

  // The server record comes back verbatim; the stubbed internal field
  // can never reach a screen (STRIPPED at the boundary).
  expect(created.member_no).toBe("GP-0001");
  expect("internal_account_seed" in created).toBe(false);
});

test("the SAME key retries as the SAME header value; a changed submission carries a DIFFERENT caller key — each attempt is exactly ONE POST (no transport-level retry)", async () => {
  await membersApi.createMember(
    { type: "person", name: "Jane Wanjiku", phone: null, email: null },
    "key-stable-1",
  );
  await membersApi.createMember(
    { type: "person", name: "Jane Wanjiku", phone: null, email: null },
    "key-stable-1",
  );
  await membersApi.createMember(
    { type: "company", name: "Prestige Traders Ltd", phone: null, email: null },
    "key-rotated-2",
  );
  const posts = calls.filter((call) => call.method === "POST");
  expect(posts).toHaveLength(3);
  // Identical retry: byte-identical key — the server-side replay
  // window (stored request hash + response, gate 1.4) can do its work.
  expect(posts[0]!.headers.get("idempotency-key")).toBe("key-stable-1");
  expect(posts[1]!.headers.get("idempotency-key")).toBe("key-stable-1");
  // Changed content: the key MUST differ, or the replay window would
  // serve the previous member for a different registration.
  expect(posts[2]!.headers.get("idempotency-key")).toBe("key-rotated-2");
  expect(posts[2]!.headers.get("idempotency-key")).not.toBe(
    posts[0]!.headers.get("idempotency-key"),
  );
});

test("a 422 surfaces field-level messages as ONE typed ApiError (canonical field keys, W56-5) — never a silent success", async () => {
  createStatus = 422;
  const thrown = await membersApi
    .createMember({ type: "person", name: "Jane", phone: null, email: "not-an-email" }, "key-422")
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ApiError);
  const apiError = thrown as InstanceType<typeof ApiError>;
  expect(apiError.status).toBe(422);
  expect(apiError.category).toBe("validation_error");
  expect(apiError.fields).toEqual([
    { field: "email", message: "value is not a valid email address" },
  ]);
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("a 409 (key reuse with a different request hash / server conflict) surfaces as ONE 409 ApiError — no transport-level retry, no replay", async () => {
  createStatus = 409;
  const thrown = await membersApi
    .createMember({ type: "person", name: "Jane", phone: null, email: null }, "key-conflict")
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ApiError);
  expect((thrown as InstanceType<typeof ApiError>).status).toBe(409);
  expect((thrown as InstanceType<typeof ApiError>).category).toBe("conflict");
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("an unknown member status is a contract violation and is REJECTED at the boundary — never silently rendered (issue #30 boundary posture)", async () => {
  listUnknownStatus = true;
  const thrown = await membersApi
    .fetchMembersPage(EMPTY_FILTERS, null)
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(ApiError);
  expect(String(thrown)).toContain("status");
});

test("an unknown member type is a contract violation and is REJECTED at the boundary", async () => {
  listUnknownType = true;
  const thrown = await membersApi
    .fetchMembersPage(EMPTY_FILTERS, null)
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(ApiError);
  expect(String(thrown)).toContain("type");
});
nc () => {
  listUnknownType = true;
  const thrown = await membersApi
    .fetchMembersPage(EMPTY_FILTERS, null)
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(ApiError);
  expect(String(thrown)).toContain("type");
});
expect(thrown).not.toBeInstanceOf(ApiError);
  expect(String(thrown)).toContain("type");
});
