/**
 * @jest-environment node
 *
 * Network-layer proofs for the share-transfers API layer through the
 * REAL generated client + middleware (node environment: real Request/
 * Response/Headers; fetch stubbed at the network boundary), mirroring
 * the corrections/recovery reference harnesses (issue #31 batch 6,
 * ledger (e)):
 * - Bearer/tenant/Idempotency-Key travel as HEADERS; nothing secret
 *   ever enters a URL; the transferring member rides the PATH, the
 *   transferee and the amount ride the BODY — key-exact.
 * - MONEY (blocker (a)): the amount travels as the typed decimal
 *   STRING verbatim; every response figure is asserted by the Zod
 *   boundary (numbers REJECTED, wrong scale REJECTED); extra keys
 *   are STRIPPED; a missing key REFUSES (nullable-free contract —
 *   every ShareTransferOut key is required).
 * - A 409 (balance shortfall under the row locks) surfaces as a typed
 *   ApiError from ONE request; a 422 surfaces CANONICAL field keys
 *   (W56-5).
 */

// Module scope (two global-script suites would collide under tsc).
export {};

type FetchCall = { url: string; method: string; headers: Headers; body: string | null };

const TENANT = "22222222-2222-2222-2222-222222222222";
const USER_ID = "55555555-5555-5555-5555-555555555555";
const FROM_ID = "11111111-1111-1111-1111-111111111111";
const TO_ID = "33333333-3333-3333-3333-333333333333";

const calls: FetchCall[] = [];
let transferStatus = 201;

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(sub: string, expInSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + expInSeconds;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

const transferOut = {
  transfer_id: "aaaabbbb-1111-2222-3333-444444444444",
  out_txn_ref: "ST-OUT-000123",
  in_txn_ref: "ST-IN-000123",
  amount: "5000.10",
  from_balance_after: "15000.25",
  to_balance_after: "20000.35",
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
  if (path === `/members/${FROM_ID}/share-transfers` && request.method === "POST") {
    if (transferStatus === 409) {
      return json(409, { category: "conflict", correlation_id: "corr-shortfall" });
    }
    if (transferStatus === 422) {
      // FastAPI validation body — the loc head is stripped to the
      // CANONICAL field key by toApiError (W56-5).
      return json(422, {
        detail: [{ loc: ["body", "to_member_id"], msg: "Input should be a valid UUID" }],
      });
    }
    // An internal lock note smuggled onto the response is STRIPPED at
    // the Zod boundary — it can never reach a screen.
    return json(201, { ...transferOut, internal_lock_note: "ROW-LOCK-SECRET" });
  }
  return json(404, { category: "not_found", correlation_id: "corr-n" });
}

// The generated client captures globalThis.fetch at creation time —
// install the stub BEFORE requiring the modules under test.
globalThis.fetch = fetchStub as typeof globalThis.fetch;
process.env.NEXT_PUBLIC_TENANT_ID = TENANT;

// Node has no window: back the per-tab custody site with a Map (the
// real storage read/write path still runs) — reference-harness model.
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
const sharesApi = require("../api") as typeof import("../api");
const sharesSchemas = require("../schemas") as typeof import("../schemas");
const { ApiError } = require("@genesis/api-client") as typeof import("@genesis/api-client");
/* eslint-enable @typescript-eslint/no-require-imports */

const REFRESH_VALUE = "per-tab-refresh-value";

beforeEach(() => {
  calls.length = 0;
  transferStatus = 201;
  session.clearSession();
  session.setSession({ accessToken: jwt(USER_ID, 900), refreshToken: REFRESH_VALUE });
});

afterEach(() => {
  session.clearSession();
});

test("POST /members/{id}/share-transfers: the transferring member rides the PATH; the body is EXACTLY {to_member_id, amount} with the typed decimal STRING verbatim; secrets ride as HEADERS; extra response keys are STRIPPED", async () => {
  const result = await sharesApi.transferShares(FROM_ID, TO_ID, "5000.10", "key-transfer-1");
  expect(calls).toHaveLength(1);
  const call = calls[0]!;
  expect(call.method).toBe("POST");
  const url = new URL(call.url);
  expect(url.pathname).toBe(`/members/${FROM_ID}/share-transfers`);
  // No query parameter exists on this contract at all.
  expect(url.search).toBe("");
  expect(call.headers.get("authorization")).toMatch(/^Bearer /);
  expect(call.headers.get("x-tenant-id")).toBe(TENANT);
  expect(call.headers.get("idempotency-key")).toBe("key-transfer-1");
  expect(call.url).not.toContain(REFRESH_VALUE);

  // KEY-EXACT body (falsifiable: smuggle a rate, date or version into
  // the API layer and this fails); the amount is the STRING verbatim
  // — a float can never start from here.
  const body = JSON.parse(call.body ?? "{}") as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(["amount", "to_member_id"]);
  expect(body["to_member_id"]).toBe(TO_ID);
  expect(body["amount"]).toBe("5000.10");

  // The SERVER's figures verbatim; the smuggled internal field never
  // parses through the boundary.
  expect(result.amount).toBe("5000.10");
  expect(result.from_balance_after).toBe("15000.25");
  expect(result.to_balance_after).toBe("20000.35");
  expect(result.out_txn_ref).toBe("ST-OUT-000123");
  expect(result.in_txn_ref).toBe("ST-IN-000123");
  expect("internal_lock_note" in result).toBe(false);
});

test("a 409 (balance shortfall under the row locks) surfaces as ONE typed ApiError from ONE request — never a silent success, never a retry", async () => {
  transferStatus = 409;
  const thrown = await sharesApi
    .transferShares(FROM_ID, TO_ID, "5000.10", "key-transfer-409")
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ApiError);
  const apiError = thrown as InstanceType<typeof ApiError>;
  expect(apiError.status).toBe(409);
  expect(apiError.category).toBe("conflict");
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("a 422 surfaces field-level messages as ONE typed ApiError with CANONICAL field keys (W56-5)", async () => {
  transferStatus = 422;
  const thrown = await sharesApi
    .transferShares(FROM_ID, TO_ID, "5000.10", "key-transfer-422")
    .catch((error: unknown) => error);
  expect(thrown).toBeInstanceOf(ApiError);
  const apiError = thrown as InstanceType<typeof ApiError>;
  expect(apiError.status).toBe(422);
  expect(apiError.category).toBe("validation_error");
  expect(apiError.fields).toEqual([
    { field: "to_member_id", message: "Input should be a valid UUID" },
  ]);
  expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test("accept/reject matrix (hand-computed oracles): every ShareTransferOut money figure asserts the canonical str(Decimal) two-place shape — numbers, wrong scale, grouping and negatives REJECT; every key is REQUIRED (key exactness)", () => {
  const withField = (field: string, value: unknown) =>
    sharesSchemas.shareTransferResultSchema.safeParse({ ...transferOut, [field]: value }).success;

  // Canonical shapes ACCEPTED — exactly the backend str(Decimal)
  // serialisation; "0.00" is the legitimate emptied-transferor value.
  expect(withField("amount", "5000.10")).toBe(true);
  expect(withField("from_balance_after", "0.00")).toBe(true);
  expect(withField("to_balance_after", "1000000000.00")).toBe(true);

  // Garbage REJECTED on every money field — a number can never enter.
  const moneyFields = ["amount", "from_balance_after", "to_balance_after"];
  const garbage = [5000.1, 5000, "5000.1", "5000.100", "5,000.10", "-1.00", "1e5", "NaN", ""];
  for (const field of moneyFields) {
    for (const value of garbage) {
      expect(withField(field, value)).toBe(false);
    }
  }

  // KEY EXACTNESS: every ShareTransferOut key is REQUIRED — dropping
  // any one is contract drift and refuses to parse (falsifiable:
  // soften a key to .optional() and this leg fails).
  const parse = (record: Record<string, unknown>) =>
    sharesSchemas.shareTransferResultSchema.safeParse(record).success;
  for (const key of Object.keys(transferOut)) {
    const missing: Record<string, unknown> = { ...transferOut };
    delete missing[key];
    expect(parse(missing)).toBe(false);
  }
  // No nullable leg exists on this contract: null refuses everywhere.
  for (const key of Object.keys(transferOut)) {
    expect(withField(key, null)).toBe(false);
  }
});

test("entry pre-validation matrix (hand-computed oracles): UUID shape, amount shape (no leading zeros, ≤2dp, > 0) and the self-transfer refusal — the layer above never even constructs a wire call from garbage", () => {
  const parse = (entry: { from_member_id: string; to_member_id: string; amount: string }) =>
    sharesSchemas.transferEntrySchema.safeParse(entry).success;

  expect(parse({ from_member_id: FROM_ID, to_member_id: TO_ID, amount: "5000.10" })).toBe(true);
  expect(parse({ from_member_id: FROM_ID, to_member_id: TO_ID, amount: "5000" })).toBe(true);
  // Self-transfer (case-insensitive) refused.
  expect(
    parse({ from_member_id: FROM_ID, to_member_id: FROM_ID.toUpperCase(), amount: "5000.10" }),
  ).toBe(false);
  // Amount shape.
  for (const bad of ["0", "0.00", "007.10", "5000.123", "-1.00", "5,000.10", "1e5", ""]) {
    expect(parse({ from_member_id: FROM_ID, to_member_id: TO_ID, amount: bad })).toBe(false);
  }
  // UUID shape.
  expect(parse({ from_member_id: "not-a-uuid", to_member_id: TO_ID, amount: "5000.10" })).toBe(
    false,
  );
  expect(parse({ from_member_id: FROM_ID, to_member_id: "nope", amount: "5000.10" })).toBe(false);
});
