/**
 * Share-transfers console adversarial tests THROUGH THE REAL SCREEN
 * CODE (issue #31 batch 6, ledger (e) — audit #30 R2 remainder). The
 * feature API layer is stubbed at the module boundary; rendering,
 * permission gating, idempotency-key custody, the typed confirmation
 * and 409 handling are the real shipped code, mounted under the REAL
 * <Providers>.
 *
 * Centrepieces (the corrections/recovery reference-harness pyramid):
 * - MONEY VERBATIM & NON-ADDITIVE (blocker (a)): the result panel
 *   renders the server's three figures exactly — the fixture is
 *   deliberately NON-ADDITIVE (no rendered figure equals the sum of
 *   any two others), so a client-side sum CANNOT sneak through as a
 *   coincidence; every plausible sum is asserted ABSENT.
 * - EXACTLY ONE write per intent: typed confirmation starts DISARMED;
 *   a triple-clicked confirm posts ONCE; a 409 gets the explicit
 *   reload flow and the re-entered intent carries a ROTATED key; a
 *   legitimate identical SECOND transfer is a NEW intent (rotated).
 * - Deny-by-default: members:view-only gets NO transfer form at all.
 * - XSS inertness on the server-influenced strings (ledger refs).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@genesis/api-client";
import { Providers } from "@/app/providers";
import { clearSession, hasSession, setSession } from "@/modules/auth/session";
import { usePermissions } from "@/modules/authz/usePermissions";
import { ShareTransfersScreen } from "../components/ShareTransfersScreen";
import type { ShareTransferResult } from "../schemas";
import * as sharesApi from "../api";

jest.mock("../api", () => {
  const actual = jest.requireActual<typeof import("../api")>("../api");
  return {
    ...actual,
    transferShares: jest.fn(),
  };
});

jest.mock("@/modules/authz/usePermissions", () => ({
  usePermissions: jest.fn(),
}));

const mocked = jest.mocked(sharesApi);
const mockedPermissions = jest.mocked(usePermissions);

const ADMIN_ID = "99999999-9999-9999-9999-999999999999";
const FROM_ID = "11111111-1111-1111-1111-111111111111";
const TO_ID = "22222222-2222-2222-2222-222222222222";
const PHRASE = FROM_ID.slice(0, 8);

/**
 * NON-ADDITIVE by construction (blocker (a)): 5000.10 + 15000.25 =
 * 20005.35 ≠ 20000.35; 5000.10 + 20000.35 = 25005.45; 15000.25 +
 * 20000.35 = 35000.60 — none of these sums equals ANY rendered
 * figure, and each is asserted ABSENT from the DOM below.
 */
const RESULT: ShareTransferResult = {
  transfer_id: "aaaabbbb-1111-2222-3333-444444444444",
  out_txn_ref: "ST-OUT-000123",
  in_txn_ref: "ST-IN-000123",
  amount: "5000.10",
  from_balance_after: "15000.25",
  to_balance_after: "20000.35",
};

const FULL_PERMS = {
  role_id: ADMIN_ID,
  permissions: [
    { module: "members", can_view: true, can_create: true, can_edit: true, can_approve: true },
  ],
};

/** members:view ONLY — equity moves are approve-gated. */
const VIEW_ONLY_PERMS = {
  role_id: ADMIN_ID,
  permissions: [
    { module: "members", can_view: true, can_create: false, can_edit: false, can_approve: false },
  ],
};

function grantPermissions(perms: typeof FULL_PERMS | typeof VIEW_ONLY_PERMS) {
  mockedPermissions.mockReturnValue({
    data: perms,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof usePermissions>);
}

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(sub: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

function mountScreen() {
  return render(
    <Providers>
      <ShareTransfersScreen />
    </Providers>,
  );
}

/** Fill the three-field entry form with valid values. */
async function fillEntry(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Transferring member id"), FROM_ID);
  await user.type(screen.getByLabelText("Receiving member id"), TO_ID);
  await user.type(screen.getByLabelText("Amount (KES)"), "5000.10");
}

/** Submit the form, type the byte-identical phrase, return the danger
 * confirm button. */
async function armConfirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Transfer shares…" }));
  await user.type(await screen.findByLabelText(`Type "${PHRASE}" to confirm`), PHRASE);
  return screen.getByRole("button", { name: "Transfer shares" });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearSession();
  setSession({ accessToken: fakeJwt(ADMIN_ID), refreshToken: "refresh-1" });
  grantPermissions(FULL_PERMS);
  mocked.transferShares.mockResolvedValue(RESULT);
});

afterEach(() => {
  clearSession();
});

test("deny-by-default: members:view ONLY gets NO transfer form (the honest note renders instead) — zero write calls possible", () => {
  grantPermissions(VIEW_ONLY_PERMS);
  mountScreen();

  expect(screen.getByText(/no members approval permission/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Transferring member id")).toBeNull();
  expect(screen.queryByLabelText("Amount (KES)")).toBeNull();
  expect(screen.queryByRole("button", { name: "Transfer shares…" })).toBeNull();
  expect(mocked.transferShares).not.toHaveBeenCalled();
});

test("contract honesty: the screen STATES the missing read register (recorded on #31) — no fake history/list is rendered", () => {
  mountScreen();

  expect(screen.getByText(/no transfer register to consult here/)).toBeInTheDocument();
  expect(screen.getByText(/recorded on issue #31/)).toBeInTheDocument();
  // No table exists on this screen at all — nothing to fake it with.
  expect(screen.queryByRole("table")).toBeNull();
});

test("client pre-validation refuses garbage BEFORE any wire attempt: malformed UUIDs, a self-transfer, a zero amount and leading zeros never reach the API layer", async () => {
  const user = userEvent.setup();
  mountScreen();

  // Malformed ids + malformed amount.
  await user.type(screen.getByLabelText("Transferring member id"), "not-a-uuid");
  await user.type(screen.getByLabelText("Receiving member id"), "also-bad");
  await user.type(screen.getByLabelText("Amount (KES)"), "007.10");
  await user.click(screen.getByRole("button", { name: "Transfer shares…" }));
  expect(
    (await screen.findAllByText("Enter the full member UUID (8-4-4-4-12 hex).")).length,
  ).toBe(2);
  expect(
    screen.getByText(/Decimal amount, e.g. 5000 or 5000.50 — no leading zeros\./),
  ).toBeInTheDocument();

  // Self-transfer: refused with the server's semantics stated.
  await user.clear(screen.getByLabelText("Transferring member id"));
  await user.clear(screen.getByLabelText("Receiving member id"));
  await user.clear(screen.getByLabelText("Amount (KES)"));
  await user.type(screen.getByLabelText("Transferring member id"), FROM_ID);
  await user.type(screen.getByLabelText("Receiving member id"), FROM_ID);
  await user.type(screen.getByLabelText("Amount (KES)"), "0.00");
  await user.click(screen.getByRole("button", { name: "Transfer shares…" }));
  expect(
    await screen.findByText("Shares cannot be transferred to the same member."),
  ).toBeInTheDocument();
  expect(screen.getByText("The amount must be greater than zero.")).toBeInTheDocument();

  expect(mocked.transferShares).not.toHaveBeenCalled();
});

test("typed confirmation starts DISARMED; a triple-clicked confirm posts EXACTLY ONE transfer; the result renders the server's NON-ADDITIVE figures VERBATIM and no client-side sum exists anywhere", async () => {
  const user = userEvent.setup();
  let release: (value: ShareTransferResult) => void = () => undefined;
  mocked.transferShares.mockImplementation(
    () =>
      new Promise<ShareTransferResult>((resolve) => {
        release = resolve;
      }),
  );
  mountScreen();
  await fillEntry(user);

  await user.click(screen.getByRole("button", { name: "Transfer shares…" }));
  // Disarmed until the byte-identical phrase — a reflex click writes
  // nothing.
  const disarmed = screen.getByRole("button", { name: "Transfer shares" });
  expect(disarmed).toBeDisabled();
  expect(mocked.transferShares).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText(`Type "${PHRASE}" to confirm`), PHRASE);
  const confirm = screen.getByRole("button", { name: "Transfer shares" });
  await user.click(confirm);
  await user.click(confirm);
  await user.click(confirm);
  expect(mocked.transferShares).toHaveBeenCalledTimes(1);
  // The typed decimal STRING travels verbatim — never a float.
  expect(mocked.transferShares.mock.calls[0]?.[0]).toBe(FROM_ID);
  expect(mocked.transferShares.mock.calls[0]?.[1]).toBe(TO_ID);
  expect(mocked.transferShares.mock.calls[0]?.[2]).toBe("5000.10");

  release(RESULT);

  // The SPENT result panel replaces the form…
  expect(await screen.findByText(/Transfer posted · ST-OUT-000123 \/ ST-IN-000123/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Transferring member id")).toBeNull();
  // …with every figure VERBATIM (trailing cents survive)…
  expect(screen.getByText("KES 5,000.10")).toBeInTheDocument();
  expect(screen.getByText("KES 15,000.25")).toBeInTheDocument();
  expect(screen.getByText("KES 20,000.35")).toBeInTheDocument();
  // …and NO sum of any two figures anywhere (non-additive proof —
  // falsifiable: render any client-computed sum and this fails).
  expect(screen.queryByText("KES 20,005.35")).toBeNull();
  expect(screen.queryByText("KES 25,005.45")).toBeNull();
  expect(screen.queryByText("KES 35,000.60")).toBeNull();
  expect(mocked.transferShares).toHaveBeenCalledTimes(1);
});

test("409 (balance shortfall / inactive member): EXACTLY ONE attempt; the explicit acknowledge flow NEVER replays; the re-entered intent carries a ROTATED key (!60 F3)", async () => {
  const user = userEvent.setup();
  mocked.transferShares
    .mockRejectedValueOnce(new ApiError(409, "conflict", "corr-shortfall"))
    .mockResolvedValue(RESULT);
  mountScreen();
  await fillEntry(user);

  await user.click(await armConfirm(user));
  expect(await screen.findByText(/Your change was NOT applied/)).toBeInTheDocument();
  expect(mocked.transferShares).toHaveBeenCalledTimes(1);
  const staleKey = mocked.transferShares.mock.calls[0]?.[3];

  await user.click(screen.getByRole("button", { name: "Reload record" }));
  expect(
    await screen.findByText(/Nothing was posted by the conflicted attempt/),
  ).toBeInTheDocument();
  expect(mocked.transferShares).toHaveBeenCalledTimes(1);

  // Re-entering the IDENTICAL transfer after the acknowledged conflict
  // is a NEW intent — rotated key.
  await user.click(await armConfirm(user));
  await waitFor(() => expect(mocked.transferShares).toHaveBeenCalledTimes(2));
  expect(mocked.transferShares.mock.calls[1]?.[3]).not.toBe(staleKey);
  expect(hasSession()).toBe(true);
});

test("a legitimate identical SECOND transfer (Record another) is a NEW intent with a ROTATED key — never served the first transfer's stored response", async () => {
  const user = userEvent.setup();
  mountScreen();
  await fillEntry(user);
  await user.click(await armConfirm(user));

  expect(await screen.findByText(/Transfer posted/)).toBeInTheDocument();
  const firstKey = mocked.transferShares.mock.calls[0]?.[3];

  await user.click(screen.getByRole("button", { name: "Record another transfer" }));
  // The form returns EMPTY (a new intent, not a prefilled replay).
  expect(screen.getByLabelText("Transferring member id")).toHaveValue("");
  await fillEntry(user);
  await user.click(await armConfirm(user));
  await waitFor(() => expect(mocked.transferShares).toHaveBeenCalledTimes(2));
  expect(mocked.transferShares.mock.calls[1]?.[3]).not.toBe(firstKey);
});

test("non-409 server refusal renders the SANITIZED error banner (category + ref only), session intact, form still armed for correction", async () => {
  const user = userEvent.setup();
  mocked.transferShares.mockRejectedValue(new ApiError(403, "forbidden", "corr-f"));
  mountScreen();
  await fillEntry(user);
  await user.click(await armConfirm(user));

  expect(await screen.findByText(/Not permitted\./)).toBeInTheDocument();
  expect(screen.getByText(/ref: corr-f/)).toBeInTheDocument();
  expect(screen.queryByText(/forbidden/i)).toBeNull();
  expect(mocked.transferShares).toHaveBeenCalledTimes(1);
  expect(hasSession()).toBe(true);
  expect(screen.getByLabelText("Transferring member id")).toBeInTheDocument();
});

test("XSS inertness: hostile ledger refs in the transfer response render as inert TEXT (no element injection)", async () => {
  const user = userEvent.setup();
  mocked.transferShares.mockResolvedValue({
    ...RESULT,
    out_txn_ref: "<img src=x onerror=window.__pwned=1>",
    in_txn_ref: "<script>window.__pwned=2</script>",
  });
  const { container } = mountScreen();
  await fillEntry(user);
  await user.click(await armConfirm(user));

  expect(await screen.findByText(/Transfer posted/)).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
  expect((window as { __pwned?: unknown }).__pwned).toBeUndefined();
});
