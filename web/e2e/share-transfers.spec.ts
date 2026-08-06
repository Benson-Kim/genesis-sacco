/**
 * Share-transfers console E2E (issue #31 batch 6, ledger (e) — audit
 * #30 R2 remainder), driven through the REAL production build in a
 * real browser — OTP login UI, session custody, deny-by-default
 * guards, generated client, the typed confirmation and the
 * Idempotency-Key custody.
 *
 * The API is mocked at the BROWSER network boundary (page.route):
 * request counts/bodies/headers are asserted server-side-of-the-wire,
 * so the single-write proof (the body is EXACTLY {to_member_id,
 * amount} with the typed decimal STRING verbatim), the header custody
 * and the deny-by-default zero-call proof measure real network
 * effects.
 */
import { expect, test, type Page } from "@playwright/test";

const API_ORIGIN = "http://localhost:8000";
const ADMIN_ID = "99999999-9999-9999-9999-999999999999";
const FROM_ID = "11111111-1111-1111-1111-111111111111";
const TO_ID = "33333333-3333-3333-3333-333333333333";

/** ConfirmDangerModal phrase (the transferring member's id prefix). */
const PHRASE = FROM_ID.slice(0, 8);

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "*",
};

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(sub: string): string {
  const exp = Math.floor(Date.now() / 1000) + 900;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

const FULL_PERMISSIONS = {
  role_id: "77777777-7777-7777-7777-777777777777",
  permissions: [
    { module: "members", can_view: true, can_create: true, can_edit: true, can_approve: true },
  ],
};

/**
 * NON-ADDITIVE server response (blocker (a)): no rendered figure
 * equals the sum of any two others — a client-side sum cannot pass as
 * a coincidence; the sums are asserted ABSENT below.
 */
const TRANSFER_RESULT = {
  transfer_id: "aaaabbbb-1111-2222-3333-444444444444",
  out_txn_ref: "ST-OUT-000123",
  in_txn_ref: "ST-IN-000123",
  amount: "5000.10",
  from_balance_after: "15000.25",
  to_balance_after: "20000.35",
};

interface ApiState {
  /** Permissions served to /me/permissions (defaults to full). */
  permissions?: unknown;
  /** Returns [status, body] for the transfer POST. */
  postTransfer: () => [number, unknown];
  transferBodies: string[];
  transferHeaders: Record<string, string>[];
  transferUrls: string[];
  /** EVERY request touching share-transfers (deny-by-default proof). */
  transferCalls: number;
}

/** Browser-boundary API mock with CORS handling and write capture. */
async function mockApi(page: Page, state: ApiState): Promise<void> {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname;
    const respond = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify(body),
      });

    if (path.includes("/share-transfers")) state.transferCalls += 1;

    if (method === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    if (path === "/auth/otp/request" && method === "POST") {
      await respond(200, {});
      return;
    }
    if (path === "/auth/otp/verify" && method === "POST") {
      await respond(200, {
        access_token: jwt(ADMIN_ID),
        refresh_token: "e2e-refresh-1",
        expires_in: 900,
      });
      return;
    }
    if (path === "/auth/refresh" && method === "POST") {
      await respond(200, {
        access_token: jwt(ADMIN_ID),
        refresh_token: "e2e-refresh-rotated",
        expires_in: 900,
      });
      return;
    }
    if (path === "/me/permissions" && method === "GET") {
      await respond(200, state.permissions ?? FULL_PERMISSIONS);
      return;
    }
    if (path === `/members/${FROM_ID}/share-transfers` && method === "POST") {
      state.transferBodies.push(request.postData() ?? "");
      state.transferHeaders.push(await request.allHeaders());
      state.transferUrls.push(request.url());
      const [status, responseBody] = state.postTransfer();
      await respond(status, responseBody);
      return;
    }
    await respond(404, { category: "not_found", correlation_id: "corr-e2e-404" });
  });
}

/** Drive the REAL OTP login UI. */
async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@sacco.co.ke");
  await page.getByRole("button", { name: "Send OTP" }).click();
  for (let index = 1; index <= 6; index += 1) {
    await page.getByLabel(`Digit ${index}`).fill(String(index));
  }
  await page.getByRole("button", { name: "Verify & sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("happy path: OTP login → Share transfers console → typed confirmation → exactly ONE wire POST with {to_member_id, amount} ONLY (typed decimal STRING) and the Idempotency-Key as a HEADER → NON-ADDITIVE result renders VERBATIM", async ({
  page,
}) => {
  const state: ApiState = {
    postTransfer: () => [201, TRANSFER_RESULT],
    transferBodies: [],
    transferHeaders: [],
    transferUrls: [],
    transferCalls: 0,
  };
  await mockApi(page, state);
  await login(page);

  await page.getByRole("link", { name: "Share transfers" }).click();
  // The console states its contract honestly: the missing read
  // register is recorded on #31, never faked.
  await expect(page.getByText(/no transfer register to consult here/)).toBeVisible();

  await page.getByLabel("Transferring member id").fill(FROM_ID);
  await page.getByLabel("Receiving member id").fill(TO_ID);
  await page.getByLabel("Amount (KES)").fill("5000.10");
  await page.getByRole("button", { name: "Transfer shares…" }).click();

  // Typed confirmation: the danger button starts DISABLED; nothing
  // has reached the wire yet.
  const confirmButton = page.getByRole("button", { name: "Transfer shares", exact: true });
  await expect(confirmButton).toBeDisabled();
  expect(state.transferBodies).toHaveLength(0);
  await page.getByLabel(`Type "${PHRASE}" to confirm`).fill(PHRASE);
  await confirmButton.click();

  // The result panel renders the SERVER's figures VERBATIM (trailing
  // cents survive) — and no sum of any two figures exists anywhere
  // (5000.10 + 15000.25 = 20005.35; + 20000.35 = 25005.45; 15000.25 +
  // 20000.35 = 35000.60).
  await expect(page.getByText("Transfer posted · ST-OUT-000123 / ST-IN-000123")).toBeVisible();
  await expect(page.getByText("KES 5,000.10")).toBeVisible();
  await expect(page.getByText("KES 15,000.25")).toBeVisible();
  await expect(page.getByText("KES 20,000.35")).toBeVisible();
  await expect(page.getByText("KES 20,005.35")).toHaveCount(0);
  await expect(page.getByText("KES 25,005.45")).toHaveCount(0);
  await expect(page.getByText("KES 35,000.60")).toHaveCount(0);
  // The SPENT affordance: the form is replaced by the result panel.
  await expect(page.getByLabel("Transferring member id")).toHaveCount(0);

  // Exactly ONE write reached the wire: the transferring member rides
  // the PATH, the body is KEY-EXACT {to_member_id, amount} with the
  // typed decimal STRING verbatim, secrets ride as HEADERS, the query
  // string is EMPTY.
  expect(state.transferBodies).toHaveLength(1);
  expect(JSON.parse(state.transferBodies[0] ?? "null")).toEqual({
    to_member_id: TO_ID,
    amount: "5000.10",
  });
  expect(state.transferHeaders[0]?.["idempotency-key"]).toBeTruthy();
  expect(state.transferHeaders[0]?.["authorization"]).toMatch(/^Bearer /);
  expect(new URL(state.transferUrls[0] ?? "").search).toBe("");
});

test("adversarial: deny-by-default — a role without the members module gets no Share transfers nav entry, an Access denied guard on the direct URL and ZERO share-transfer calls; a members:view-only role reaches the screen but gets NO form", async ({
  page,
}) => {
  const state: ApiState = {
    permissions: {
      role_id: "66666666-6666-6666-6666-666666666666",
      permissions: [
        {
          module: "transactions",
          can_view: true,
          can_create: false,
          can_edit: false,
          can_approve: false,
        },
      ],
    },
    postTransfer: () => [403, { category: "forbidden", correlation_id: "corr-e2e-403" }],
    transferBodies: [],
    transferHeaders: [],
    transferUrls: [],
    transferCalls: 0,
  };
  await mockApi(page, state);
  await login(page);

  // Permission-filtered nav: the Share transfers entry never mounts.
  await expect(page.getByRole("link", { name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Share transfers" })).toHaveCount(0);

  // Direct navigation hits the deny-by-default route guard — ZERO
  // share-transfer requests from the stripped role.
  await page.goto("/modules/members/share-transfers");
  await expect(page.getByText("Access denied")).toBeVisible();
  await expect(page.getByLabel("Transferring member id")).toHaveCount(0);
  expect(state.transferCalls).toBe(0);
  expect(state.transferBodies).toHaveLength(0);
});

test("adversarial: members:view-only reaches the console but the transfer form is structurally WITHHELD (equity moves are approve-gated) — zero write calls possible", async ({
  page,
}) => {
  const state: ApiState = {
    permissions: {
      role_id: "66666666-6666-6666-6666-666666666666",
      permissions: [
        {
          module: "members",
          can_view: true,
          can_create: false,
          can_edit: false,
          can_approve: false,
        },
      ],
    },
    postTransfer: () => [403, { category: "forbidden", correlation_id: "corr-e2e-403" }],
    transferBodies: [],
    transferHeaders: [],
    transferUrls: [],
    transferCalls: 0,
  };
  await mockApi(page, state);
  await login(page);

  await page.getByRole("link", { name: "Share transfers" }).click();
  await expect(page.getByText(/no members approval permission/)).toBeVisible();
  await expect(page.getByLabel("Transferring member id")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transfer shares…" })).toHaveCount(0);
  expect(state.transferCalls).toBe(0);
  expect(state.transferBodies).toHaveLength(0);
});
