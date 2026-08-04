/**
 * Settings screen adversarial tests THROUGH THE REAL SCREEN CODE (P15
 * Settings/products batch), mirroring the users-screen reference suite:
 * the feature API layer is stubbed at the module boundary; rendering,
 * tab orchestration, typed-confirmation gating, WYSIWYG null-clearing
 * writes, 409 handling, idempotency-key custody and permission gating
 * are the real shipped code, mounted under the REAL <Providers>.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@genesis/api-client";
import { Providers } from "@/app/providers";
import { clearSession, hasSession, setSession } from "@/modules/auth/session";
import { usePermissions } from "@/modules/authz/usePermissions";
import { SettingsScreen } from "../components/SettingsScreen";
import { settingsSchema, type Settings } from "../schemas";
import * as settingsApi from "../api";

jest.mock("../api", () => {
  const actual = jest.requireActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchSettings: jest.fn(),
    updateSettings: jest.fn(),
  };
});

jest.mock("@/modules/authz/usePermissions", () => ({
  usePermissions: jest.fn(),
}));

const mocked = jest.mocked(settingsApi);
const mockedPermissions = jest.mocked(usePermissions);

// Attacker-influenced stored key name (corrupt_keys is the only
// server-echoed free string on this screen) — must render as inert text.
const HOSTILE_KEY = "<img src=x onerror=window.__pwned=1>";
const ADMIN_ID = "99999999-9999-9999-9999-999999999999";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(sub: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

function baseSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    configured: true,
    version: 5,
    corrupt_keys: [],
    deposit_interest_annual_rate_pct: "9.00",
    dividend_rate_pct: "14.00",
    deposit_rebate_rate_pct: null,
    penalty_rate_pct_per_month: "1.50",
    penalty_grace_days: 5,
    penalty_charged_on: "instalment_in_arrears",
    loan_interest_method: "reducing_balance",
    loan_interest_basis: "actual_365",
    loan_rate_bands: [
      { min_amount: "0", max_amount: "100000.00", rate_pct: "12.00" },
      { min_amount: "100000.00", max_amount: null, rate_pct: "14.00" },
    ],
    min_share_capital: "15000.00",
    registration_fee: "1000.00",
    min_monthly_contribution: "2000.00",
    max_member_exposure: "2000000.00",
    dormancy_period_months: 6,
    financial_year_end_month: 12,
    exit_notice_period_days: 30,
    exit_fee: "500.00",
    committee_size: 5,
    committee_quorum: 3,
    approval_bands: [
      { authority: "Loan Officer", max_amount: "100000.00" },
      { authority: "Credit Committee", max_amount: null },
    ],
    ...overrides,
  };
}

const FULL_PERMS = {
  role_id: ADMIN_ID,
  permissions: [
    { module: "settings", can_view: true, can_create: true, can_edit: true, can_approve: true },
  ],
};

const VIEW_ONLY_PERMS = {
  role_id: ADMIN_ID,
  permissions: [
    {
      module: "settings",
      can_view: true,
      can_create: false,
      can_edit: false,
      can_approve: false,
    },
  ],
};

function grantPermissions(perms: typeof FULL_PERMS) {
  mockedPermissions.mockReturnValue({
    data: perms,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof usePermissions>);
}

function mountScreen() {
  return render(
    <Providers>
      <SettingsScreen />
    </Providers>,
  );
}

/** Drive the interest-tab save through its typed confirmation. */
async function confirmInterestSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Save interest rules" }));
  const dialog = await screen.findByRole("dialog", { name: "Apply interest rules" });
  await user.type(within(dialog).getByLabelText('Type "interest" to confirm'), "interest");
  await user.click(within(dialog).getByRole("button", { name: "Apply interest rules" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  clearSession();
  setSession({ accessToken: fakeJwt(ADMIN_ID), refreshToken: "refresh-1" });
  grantPermissions(FULL_PERMS);
  mocked.fetchSettings.mockResolvedValue(baseSettings());
});

afterEach(() => {
  clearSession();
});

test("decimal money parameters prefill VERBATIM (no reformatting, no numeric round-trip)", async () => {
  mountScreen();
  expect(await screen.findByLabelText("Interest on deposits (% p.a.)")).toHaveValue("9.00");
  expect(screen.getByLabelText("Dividend on shares (% p.a.)")).toHaveValue("14.00");
  expect(screen.getByLabelText("Penalty rate (%/mo)")).toHaveValue("1.50");
  expect(screen.getByLabelText("Band 1 upper bound (KES)")).toHaveValue("100000.00");
  expect(screen.getByLabelText("Band 1 rate (%)")).toHaveValue("12.00");
});

test("hostile corrupt_keys names render as inert TEXT (least-disclosure repair banner, named XSS threat)", async () => {
  mocked.fetchSettings.mockResolvedValue(baseSettings({ corrupt_keys: [HOSTILE_KEY] }));
  const { container } = mountScreen();

  expect(
    await screen.findByText(/failed integrity revalidation/),
  ).toBeInTheDocument();
  expect(screen.getByText(new RegExp("onerror=window"))).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
});

test("typed confirmation gates every settings save; the WYSIWYG body carries version, verbatim strings and derived band minimums", async () => {
  const user = userEvent.setup();
  mocked.updateSettings.mockResolvedValue(baseSettings({ version: 6 }));
  mountScreen();

  await user.click(await screen.findByRole("button", { name: "Save interest rules" }));
  const dialog = await screen.findByRole("dialog", { name: "Apply interest rules" });
  // Opening the confirmation writes nothing.
  expect(mocked.updateSettings).not.toHaveBeenCalled();
  const confirmButton = within(dialog).getByRole("button", { name: "Apply interest rules" });
  expect(confirmButton).toBeDisabled();
  await user.type(within(dialog).getByLabelText('Type "interest" to confirm'), "interest");
  await user.click(confirmButton);

  await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalledTimes(1));
  const body = mocked.updateSettings.mock.calls[0]?.[0];
  expect(body).toMatchObject({
    version: 5,
    loan_interest_method: "reducing_balance",
    loan_interest_basis: "actual_365",
    penalty_rate_pct_per_month: "1.50",
    penalty_grace_days: 5,
    penalty_charged_on: "instalment_in_arrears",
    deposit_interest_annual_rate_pct: "9.00",
    dividend_rate_pct: "14.00",
    // Blank field => explicit null (the API's clear-a-key contract).
    deposit_rebate_rate_pct: null,
  });
  // Band minimums derive by STRING COPY from the previous upper bound.
  expect(body?.loan_rate_bands).toEqual([
    { min_amount: "0", max_amount: "100000.00", rate_pct: "12.00" },
    { min_amount: "100000.00", max_amount: null, rate_pct: "14.00" },
  ]);
  expect(mocked.updateSettings.mock.calls[0]?.[1]).toEqual(expect.any(String));
});

test("clearing a configured field submits an explicit null (never a silent keep)", async () => {
  const user = userEvent.setup();
  mocked.updateSettings.mockResolvedValue(baseSettings({ version: 6 }));
  mountScreen();

  const dividendInput = await screen.findByLabelText("Dividend on shares (% p.a.)");
  await user.clear(dividendInput);
  await confirmInterestSave(user);

  await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalledTimes(1));
  expect(mocked.updateSettings.mock.calls[0]?.[0]).toMatchObject({
    dividend_rate_pct: null,
  });
});

test("typed confirmation NAMES the keys a save would CLEAR (W57-3) — never a silent config clear", async () => {
  const user = userEvent.setup();
  mountScreen();

  // penalty_grace_days is CONFIGURED (5) — clearing it must be disclosed.
  const grace = await screen.findByLabelText("Penalty grace (days)");
  await user.clear(grace);
  await user.click(screen.getByRole("button", { name: "Save interest rules" }));

  const dialog = await screen.findByRole("dialog", { name: "Apply interest rules" });
  const disclosure = within(dialog).getByText(/This save CLEARS the stored value of:/);
  expect(disclosure).toHaveTextContent("penalty_grace_days");
  // A field blank because it was NEVER configured is not a clear —
  // deposit_rebate_rate_pct is null in the loaded record and stays out.
  expect(disclosure).not.toHaveTextContent("deposit_rebate_rate_pct");

  // Cancelling the disclosure writes nothing.
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(mocked.updateSettings).not.toHaveBeenCalled();
});

test("stale edit: 409 shows the explicit reload flow with EXACTLY ONE write attempt; reload never replays", async () => {
  const user = userEvent.setup();
  mocked.updateSettings.mockRejectedValue(new ApiError(409, "conflict", "corr-stale"));
  mountScreen();

  await screen.findByRole("button", { name: "Save interest rules" });
  await confirmInterestSave(user);

  expect(await screen.findByText(/Your change was NOT applied/)).toBeInTheDocument();
  expect(mocked.updateSettings).toHaveBeenCalledTimes(1);
  expect(mocked.updateSettings.mock.calls[0]?.[0]).toMatchObject({ version: 5 });

  // Explicit reload refetches the record (server returns v6 with a
  // different rate); the panel remounts on the fresh version…
  mocked.fetchSettings.mockResolvedValue(
    baseSettings({ version: 6, dividend_rate_pct: "15.00" }),
  );
  await user.click(screen.getByRole("button", { name: "Reload record" }));
  expect(await screen.findByLabelText("Dividend on shares (% p.a.)")).toHaveValue("15.00");
  // …and NEVER replays the stale submission.
  expect(mocked.updateSettings).toHaveBeenCalledTimes(1);
});

test("idempotency keys: stable across retries of an identical body, rotated when the body changes", async () => {
  const user = userEvent.setup();
  mocked.updateSettings
    .mockRejectedValueOnce(new ApiError(503, "unavailable", "corr-1"))
    .mockRejectedValueOnce(new ApiError(503, "unavailable", "corr-2"))
    .mockResolvedValue(baseSettings({ version: 6 }));
  mountScreen();

  await screen.findByRole("button", { name: "Save interest rules" });
  await confirmInterestSave(user);
  await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalledTimes(1));
  await confirmInterestSave(user);
  await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalledTimes(2));

  const keyAttempt1 = mocked.updateSettings.mock.calls[0]?.[1];
  const keyAttempt2 = mocked.updateSettings.mock.calls[1]?.[1];
  expect(keyAttempt1).toBe(keyAttempt2);

  const graceInput = screen.getByLabelText("Penalty grace (days)");
  await user.clear(graceInput);
  await user.type(graceInput, "7");
  await confirmInterestSave(user);
  await waitFor(() => expect(mocked.updateSettings).toHaveBeenCalledTimes(3));
  expect(mocked.updateSettings.mock.calls[2]?.[1]).not.toBe(keyAttempt1);
});

test("UI affordances follow the matrix: view-only settings role sees NO save controls anywhere", async () => {
  grantPermissions(VIEW_ONLY_PERMS);
  const user = userEvent.setup();
  mountScreen();

  expect(await screen.findByLabelText("Interest on deposits (% p.a.)")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save interest rules" })).toBeNull();

  await user.click(screen.getByRole("tab", { name: "Parameters" }));
  expect(await screen.findByLabelText("Minimum share capital (KES)")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save parameters" })).toBeNull();

  await user.click(screen.getByRole("tab", { name: "Approval matrix" }));
  expect(await screen.findByLabelText("Committee size")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Save matrix" })).toBeNull();
});

test("least-disclosure: a 403 renders the sanitized banner only, no reload affordance, session intact", async () => {
  const user = userEvent.setup();
  mocked.updateSettings.mockRejectedValue(new ApiError(403, "forbidden", "corr-f"));
  mountScreen();

  await screen.findByRole("button", { name: "Save interest rules" });
  await confirmInterestSave(user);

  expect(await screen.findByText(/Not permitted\./)).toBeInTheDocument();
  expect(screen.getByText(/ref: corr-f/)).toBeInTheDocument();
  expect(screen.queryByText(/forbidden/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Reload record" })).toBeNull();
  expect(mocked.updateSettings).toHaveBeenCalledTimes(1);
  expect(hasSession()).toBe(true);
});

test("server 422 field verdicts render inline through form-errors (server wins)", async () => {
  const user = userEvent.setup();
  mocked.updateSettings.mockRejectedValue(
    new ApiError(422, "validation_error", null, [
      { field: "loan_rate_bands", message: "bands must be contiguous" },
    ]),
  );
  mountScreen();

  await screen.findByRole("button", { name: "Save interest rules" });
  await confirmInterestSave(user);

  // The band-level server verdict lands next to the band editor.
  expect(await screen.findAllByText(/bands must be contiguous/)).not.toHaveLength(0);
  expect(mocked.updateSettings).toHaveBeenCalledTimes(1);
});

test("query-path 401 tears the session down immediately (dual-cache teardown)", async () => {
  mocked.fetchSettings.mockRejectedValue(new ApiError(401, "unauthenticated", "corr-q"));
  mountScreen();

  await waitFor(() => expect(hasSession()).toBe(false), { timeout: 4000 });
});

test("Zod boundary rejects money as NUMBERS — a contract-violating response never reaches the DOM", () => {
  const violating = {
    ...baseSettings(),
    // The contract says decimal STRINGS; a numeric value must fail parse.
    dividend_rate_pct: 14,
  };
  expect(settingsSchema.safeParse(violating).success).toBe(false);
  expect(settingsSchema.safeParse(baseSettings()).success).toBe(true);
});

test("Zod boundary rejects unknown enum vocabulary (W57-2) — a degraded value can never be silently re-saved as null", () => {
  // Fleet standard: unknown enum values are contract violations REJECTED
  // at the boundary, closing the silent-config-clear hazard (a value the
  // select can't represent would render "not configured" and be NULLED —
  // config CLEARED — by the next WYSIWYG save of the tab).
  expect(
    settingsSchema.safeParse({ ...baseSettings(), loan_interest_method: "exotic_method" })
      .success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({ ...baseSettings(), loan_interest_basis: "actual_360" }).success,
  ).toBe(false);
  expect(
    settingsSchema.safeParse({ ...baseSettings(), penalty_charged_on: "everything" }).success,
  ).toBe(false);
  // null (genuinely not configured) remains valid — rejection targets
  // unknown vocabulary only, never the contract's explicit null.
  expect(
    settingsSchema.safeParse({
      ...baseSettings(),
      loan_interest_method: null,
      loan_interest_basis: null,
      penalty_charged_on: null,
    }).success,
  ).toBe(true);
});
