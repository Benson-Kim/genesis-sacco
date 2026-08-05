/**
 * Member-KYC screen suite (issue #31 batch 3 — the users/exits/
 * corrections reference-harness pyramid). The kyc API layer is stubbed
 * at the module boundary; rendering, wizard orchestration, 409
 * handling, idempotency-key custody and permission gating are the real
 * shipped code, mounted under the REAL <Providers> (mutations retry:0,
 * the 401 teardown — production configuration; falsifiable by flipping
 * either).
 *
 * Centrepieces:
 * - BOUNDARY: the per-type profile schemas are BUILT from the specs;
 *   hand-computed accept/reject oracles pin them to the backend
 *   grammar (domain/member_kyc.py) — wrong-type payloads, malformed
 *   informational amounts and garbage dates are REJECTED, never
 *   rendered.
 * - XSS: profile fields are operator-entered PII (attacker-influenced
 *   data) and must render byte-identical as inert TEXT.
 * - EXACTLY ONE write per intent (double-submit, denial, conflict);
 *   409s get the explicit reload flow and are never replayed.
 * - Permission-stripped rendering: without members:edit /
 *   members:create the edit, wizard, track and review affordances do
 *   not exist in the DOM.
 * - 401 tears the session down (W58-2 production wiring).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@genesis/api-client";
import { Providers } from "@/app/providers";
import { clearSession, hasSession, setSession } from "@/modules/auth/session";
import { usePermissions } from "@/modules/authz/usePermissions";
import { MembersScreen } from "../components/MembersScreen";
import {
  DOCUMENT_TRANSITIONS,
  KYC_AMOUNT_RE,
  kycDocumentSchema,
  kycProfileSchema,
  type KycDocument,
  type KycProfile,
} from "../kycSchemas";
import * as kycApi from "../kycApi";
import * as membersApi from "../api";

jest.mock("../api", () => {
  const actual = jest.requireActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchMembersPage: jest.fn(),
    fetchMember: jest.fn(),
    createMember: jest.fn(),
  };
});

jest.mock("../kycApi", () => {
  const actual = jest.requireActual<typeof import("../kycApi")>("../kycApi");
  return {
    ...actual,
    fetchKycProfile: jest.fn(),
    createKycProfile: jest.fn(),
    updateKycProfile: jest.fn(),
    fetchKycDocumentsPage: jest.fn(),
    createKycDocument: jest.fn(),
    updateKycDocument: jest.fn(),
  };
});

jest.mock("@/modules/authz/usePermissions", () => ({
  usePermissions: jest.fn(),
}));

const mocked = jest.mocked(kycApi);
const mockedMembers = jest.mocked(membersApi);
const mockedPermissions = jest.mocked(usePermissions);

const ADMIN_ID = "99999999-9999-9999-9999-999999999999";
const MEMBER_ID = "11111111-1111-1111-1111-111111111111";
const PROFILE_ID = "aaaaaaaa-1111-2222-3333-444444444444";
const DOC_ID_1 = "bbbbbbbb-1111-2222-3333-444444444444";
const DOC_ID_2 = "cccccccc-1111-2222-3333-444444444444";

// Hostile PII values (registrar-entered, attacker-influenced) — built
// without the literal cookie-sink token (client-hygiene grep gate).
const HOSTILE_NAME = "<img src=x onerror=window.__pwned=1>";
const HOSTILE_ADDRESS = '"?><script>window.__pwned=2</script> Moi Avenue';

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(sub: string): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: "HS256" })}.${b64url({ sub, exp })}.sig`;
}

const MEMBER = {
  id: MEMBER_ID,
  member_no: "GP-0001",
  type: "person" as const,
  name: "Jane Wanjiku",
  phone: null,
  email: null,
  status: "active" as const,
  version: 1,
};

function personProfile(overrides: Partial<KycProfile> = {}): KycProfile {
  return {
    id: PROFILE_ID,
    member_id: MEMBER_ID,
    member_type: "person",
    category: "Ordinary",
    profile: {
      bio: {
        first_name: HOSTILE_NAME,
        surname: "Wanjiku",
        gender: "Female",
        date_of_birth: "1990-01-01",
        id_number: "12345678",
        kra_pin: "A012345678Z",
      },
      contact: {
        phone: "+254700000001",
        email: null,
        county: "Nairobi",
        physical_address: HOSTILE_ADDRESS,
      },
      employment: {
        employment_status: "Employed",
        occupation: "Teacher",
        // Informational declared figure — must render VERBATIM (no
        // grouping, no KES prefix, no re-formatting).
        monthly_income: "123456.70",
      },
      next_of_kin: {
        name: "Peter Wanjiku",
        relationship: "Brother",
        phone: "+254700000002",
      },
    },
    dpa_consent_at: "2026-08-01T09:00:00+00:00",
    version: 3,
    created_at: "2026-08-01T09:00:00+00:00",
    ...overrides,
  };
}

function pendingDoc(overrides: Partial<KycDocument> = {}): KycDocument {
  return {
    id: DOC_ID_1,
    member_id: MEMBER_ID,
    doc_type: "national_id_copy",
    status: "pending",
    expires_at: null,
    version: 1,
    created_at: "2026-08-01T09:00:00+00:00",
    ...overrides,
  };
}

function verifiedDoc(overrides: Partial<KycDocument> = {}): KycDocument {
  return {
    id: DOC_ID_2,
    member_id: MEMBER_ID,
    doc_type: "kra_pin",
    status: "verified",
    expires_at: "2027-01-01",
    version: 2,
    created_at: "2026-08-01T09:00:00+00:00",
    ...overrides,
  };
}

const FULL_PERMS = {
  role_id: ADMIN_ID,
  permissions: [
    { module: "members", can_view: true, can_create: true, can_edit: true, can_approve: true },
  ],
};

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

function mountScreen() {
  return render(
    <Providers>
      <MembersScreen />
    </Providers>,
  );
}

async function openKycDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Jane Wanjiku"));
  return await screen.findByRole("dialog", { name: `Member KYC — ${MEMBER.name}` });
}

/** Fill every REQUIRED person field in the wizard's details step. */
function fillPersonDetails(dialog: HTMLElement) {
  const set = (label: string, value: string) => {
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
  };
  set("First name", "Jane");
  set("Surname", "Wanjiku");
  set("Gender", "Female");
  set("Date of birth", "1990-01-01");
  set("ID number", "12345678");
  set("KRA PIN", "A012345678Z");
  set("Phone (M-Pesa)", "+254700000001");
  set("County", "Nairobi");
  set("Physical address", "Moi Avenue 10");
  set("Employment status", "Employed");
  set("Occupation", "Teacher");
  set("Monthly income (KES)", "35000");
  set("Name", "Peter Wanjiku");
  set("Relationship", "Brother");
  set("Phone", "+254700000002");
}

beforeEach(() => {
  jest.clearAllMocks();
  clearSession();
  setSession({ accessToken: fakeJwt(ADMIN_ID), refreshToken: "refresh-1" });
  grantPermissions(FULL_PERMS);
  mockedMembers.fetchMembersPage.mockResolvedValue({ items: [MEMBER], nextCursor: null });
  mocked.fetchKycProfile.mockResolvedValue(personProfile());
  mocked.fetchKycDocumentsPage.mockResolvedValue({
    items: [pendingDoc(), verifiedDoc()],
    nextCursor: null,
  });
});

afterEach(() => {
  clearSession();
});

// ---------------------------------------------------------------------------
// Boundary (Zod — FM: contract violation). Hand-computed oracles.
// ---------------------------------------------------------------------------

test("boundary: a valid person profile parses; a WRONG-TYPE payload is REJECTED (never rendered)", () => {
  expect(kycProfileSchema.safeParse(personProfile()).success).toBe(true);
  // A company-shaped payload under member_type person: the per-type
  // schema (built from the specs) must refuse it — mirroring the
  // server's own validate_profile.
  const wrongType = personProfile({
    profile: {
      registration: {
        registered_name: "Prestige Traders Ltd",
        reg_number: "C-123",
        kra_pin: "P051234567X",
        incorporated_on: "2019-04-01",
        industry: "Trade",
        nature_of_business: "Wholesale",
      },
    },
  });
  expect(kycProfileSchema.safeParse(wrongType).success).toBe(false);
});

test("boundary: the informational amount grammar mirrors the backend _AMOUNT_PATTERN (hand-computed oracles)", () => {
  // Accepted by the backend grammar:
  for (const good of ["0", "35000", "35000.5", "35000.50", "1234567890123456"]) {
    expect(KYC_AMOUNT_RE.test(good)).toBe(true);
  }
  // Rejected: sign, exponent, thousands separators, three decimals,
  // seventeen integer digits, empty.
  for (const bad of ["-1", "1e5", "35,000", "35000.505", "12345678901234567", ""]) {
    expect(KYC_AMOUNT_RE.test(bad)).toBe(false);
  }
  const malformedIncome = personProfile();
  (malformedIncome.profile as Record<string, Record<string, unknown>>)[
    "employment"
  ]!["monthly_income"] = "1e5";
  expect(kycProfileSchema.safeParse(malformedIncome).success).toBe(false);
});

test("boundary: garbage dates and unknown document statuses are contract violations", () => {
  const badDate = personProfile();
  (badDate.profile as Record<string, Record<string, unknown>>)["bio"]!["date_of_birth"] =
    "01/01/1990";
  expect(kycProfileSchema.safeParse(badDate).success).toBe(false);

  expect(kycDocumentSchema.safeParse(pendingDoc()).success).toBe(true);
  expect(kycDocumentSchema.safeParse({ ...pendingDoc(), status: "approved" }).success).toBe(false);
});

test("boundary: the client transition map mirrors the backend status machine exactly (oracle from domain/member_kyc.py _DOC_ALLOWED)", () => {
  expect(DOCUMENT_TRANSITIONS).toEqual({
    pending: ["received"],
    received: ["verified", "rejected"],
    rejected: ["received"],
    verified: [],
  });
});

// ---------------------------------------------------------------------------
// Rendering: XSS inertness + verbatim informational figures.
// ---------------------------------------------------------------------------

test("XSS: hostile profile PII renders byte-identical as inert TEXT; the informational income figure renders VERBATIM", async () => {
  const user = userEvent.setup();
  const { container } = mountScreen();
  const dialog = await openKycDrawer(user);

  expect(await within(dialog).findByText(HOSTILE_NAME)).toBeInTheDocument();
  expect(within(dialog).getByText(HOSTILE_ADDRESS)).toBeInTheDocument();
  // Falsifiable: route either string through a parser sink and an
  // img/script element appears.
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();

  // Declared KYC figure: verbatim — no KES prefix, no grouping (a
  // re-format would render "KES 123,456.70", which this refuses).
  expect(within(dialog).getByText("123456.70")).toBeInTheDocument();
  expect(within(dialog).queryByText(/KES\s*123,456/)).toBeNull();
});

// ---------------------------------------------------------------------------
// Permission-stripped affordances (deny-by-default UX; server enforces).
// ---------------------------------------------------------------------------

test("permission-stripped: view-only role gets NO edit, NO wizard, NO track and NO review affordances", async () => {
  grantPermissions(VIEW_ONLY_PERMS);
  const user = userEvent.setup();
  mountScreen();
  const dialog = await openKycDrawer(user);

  await within(dialog).findByText("Ordinary");
  expect(within(dialog).queryByRole("button", { name: "Edit profile" })).toBeNull();
  // Documents rendered read-only: no transition buttons, no expiry
  // editor, no track affordances.
  await within(dialog).findByText("National ID copy");
  expect(within(dialog).queryByRole("button", { name: "Mark received" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Edit expiry" })).toBeNull();
  expect(within(dialog).queryByRole("button", { name: /^Track / })).toBeNull();
});

test("permission-stripped: without members:create the no-profile state offers NO wizard", async () => {
  grantPermissions(VIEW_ONLY_PERMS);
  mocked.fetchKycProfile.mockRejectedValue(new ApiError(404, "not_found", "corr-404"));
  const user = userEvent.setup();
  mountScreen();
  const dialog = await openKycDrawer(user);

  expect(await within(dialog).findByText(/No KYC profile on record/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Start KYC wizard" })).toBeNull();
});

// ---------------------------------------------------------------------------
// Wizard: validation, double-submit, key stability/rotation.
// ---------------------------------------------------------------------------

async function openWizard(user: ReturnType<typeof userEvent.setup>) {
  mocked.fetchKycProfile.mockRejectedValue(new ApiError(404, "not_found", "corr-404"));
  mountScreen();
  const drawer = await openKycDrawer(user);
  await user.click(await within(drawer).findByRole("button", { name: "Start KYC wizard" }));
  return await screen.findByRole("dialog", { name: `KYC registration — ${MEMBER.name}` });
}

test("wizard: a blank required field blocks Continue with an inline error — NO request leaves", async () => {
  const user = userEvent.setup();
  const dialog = await openWizard(user);

  fillPersonDetails(dialog);
  fireEvent.change(within(dialog).getByLabelText("Surname"), { target: { value: "" } });
  await user.click(within(dialog).getByRole("button", { name: "Continue" }));

  // The step did not advance and the field carries an inline error.
  expect(await within(dialog).findAllByRole("alert")).not.toHaveLength(0);
  expect(within(dialog).getByLabelText("Surname")).toHaveAccessibleDescription();
  expect(mocked.createKycProfile).not.toHaveBeenCalled();
});

test("wizard double-submit fires exactly ONE profile create; success advances to the documents step", async () => {
  const user = userEvent.setup();
  let resolveCreate: (value: KycProfile) => void = () => undefined;
  mocked.createKycProfile.mockImplementation(
    () =>
      new Promise<KycProfile>((resolve) => {
        resolveCreate = resolve;
      }),
  );
  const dialog = await openWizard(user);

  fillPersonDetails(dialog);
  await user.click(within(dialog).getByRole("button", { name: "Continue" }));
  fireEvent.change(within(dialog).getByLabelText("Member category"), {
    target: { value: "Ordinary" },
  });
  await user.click(within(dialog).getByLabelText(/Data Protection Act 2019 consent/));

  const submit = within(dialog).getByRole("button", { name: "Create KYC profile" });
  await user.click(submit);
  await user.click(submit);
  await user.click(submit);
  expect(mocked.createKycProfile).toHaveBeenCalledTimes(1);

  // The wire body: category + consent + the assembled per-type payload
  // (nested sections, informational income as a STRING).
  const [memberIdArg, inputArg] = mocked.createKycProfile.mock.calls[0]!;
  expect(memberIdArg).toBe(MEMBER_ID);
  expect(inputArg.category).toBe("Ordinary");
  expect(inputArg.dpa_consent).toBe(true);
  expect((inputArg.profile as Record<string, Record<string, unknown>>)["employment"]).toEqual({
    employment_status: "Employed",
    occupation: "Teacher",
    monthly_income: "35000",
  });
  // Optional blank email travels as EXPLICIT null (pydantic | None).
  expect(
    (inputArg.profile as Record<string, Record<string, unknown>>)["contact"]!["email"],
  ).toBeNull();

  resolveCreate(personProfile({ dpa_consent_at: "2026-08-05T10:00:00+00:00" }));
  expect(await within(dialog).findByText("Summary")).toBeInTheDocument();
  expect(within(dialog).getByText("Captured ✓")).toBeInTheDocument();
});

test("wizard: retrying an identical failed submission REUSES the Idempotency-Key; an edited submission ROTATES it", async () => {
  const user = userEvent.setup();
  mocked.createKycProfile.mockRejectedValue(new ApiError(500, "internal_error", "corr-500"));
  const dialog = await openWizard(user);

  fillPersonDetails(dialog);
  await user.click(within(dialog).getByRole("button", { name: "Continue" }));
  fireEvent.change(within(dialog).getByLabelText("Member category"), {
    target: { value: "Ordinary" },
  });

  const submit = within(dialog).getByRole("button", { name: "Create KYC profile" });
  await user.click(submit);
  await waitFor(() => expect(mocked.createKycProfile).toHaveBeenCalledTimes(1));
  await user.click(submit);
  await waitFor(() => expect(mocked.createKycProfile).toHaveBeenCalledTimes(2));
  const keyOf = (index: number) => mocked.createKycProfile.mock.calls[index]![2];
  // Identical retry: byte-identical key (the server replay window works).
  expect(keyOf(1)).toBe(keyOf(0));

  // Changed content = NEW logical intent = rotated key.
  await user.click(within(dialog).getByRole("button", { name: "‹ Back" }));
  fireEvent.change(within(dialog).getByLabelText("Occupation"), { target: { value: "Nurse" } });
  await user.click(within(dialog).getByRole("button", { name: "Continue" }));
  await user.click(within(dialog).getByRole("button", { name: "Create KYC profile" }));
  await waitFor(() => expect(mocked.createKycProfile).toHaveBeenCalledTimes(3));
  expect(keyOf(2)).not.toBe(keyOf(0));
});

// ---------------------------------------------------------------------------
// Edit: 409 single-attempt + reload-never-replays.
// ---------------------------------------------------------------------------

test("edit 409: ONE attempt, the ConflictBanner reloads the SERVER record and NOTHING is replayed", async () => {
  const user = userEvent.setup();
  mocked.updateKycProfile.mockRejectedValue(new ApiError(409, "conflict", "corr-409"));
  mountScreen();
  const dialog = await openKycDrawer(user);

  await user.click(await within(dialog).findByRole("button", { name: "Edit profile" }));
  fireEvent.change(within(dialog).getByLabelText("Occupation"), { target: { value: "Nurse" } });
  await user.click(within(dialog).getByRole("button", { name: "Save profile" }));

  expect(
    await within(dialog).findByText(/This record changed since you loaded it/),
  ).toBeInTheDocument();
  expect(mocked.updateKycProfile).toHaveBeenCalledTimes(1);
  // The stale submission pinned the loaded version.
  expect(mocked.updateKycProfile.mock.calls[0]![1].version).toBe(3);

  const before = mocked.fetchKycProfile.mock.calls.length;
  await user.click(within(dialog).getByRole("button", { name: "Reload record" }));
  // Reload REFETCHES (read path) — the write is NOT replayed.
  await waitFor(() => expect(mocked.fetchKycProfile.mock.calls.length).toBeGreaterThan(before));
  expect(mocked.updateKycProfile).toHaveBeenCalledTimes(1);
  // The edit closed: re-applying is a NEW explicit intent.
  expect(await within(dialog).findByRole("button", { name: "Edit profile" })).toBeInTheDocument();
});

// ---------------------------------------------------------------------------
// Documents: status-machine affordances, single-effect writes, expiry.
// ---------------------------------------------------------------------------

test("documents: affordances mirror the status machine — pending offers ONLY 'Mark received'; verified is terminal", async () => {
  const user = userEvent.setup();
  mountScreen();
  const dialog = await openKycDrawer(user);

  await within(dialog).findByText("National ID copy");
  const pendingRow = within(dialog).getByText("National ID copy").closest("li")!;
  // selector: the document-row label <span> — the person PROFILE also
  // renders a "KRA PIN" <dt> field label in the same dialog.
  const verifiedRow = within(dialog).getByText("KRA PIN", { selector: "span" }).closest("li")!;

  expect(within(pendingRow).getByRole("button", { name: "Mark received" })).toBeInTheDocument();
  expect(within(pendingRow).queryByRole("button", { name: "Verify" })).toBeNull();
  expect(within(pendingRow).queryByRole("button", { name: "Reject" })).toBeNull();
  // Verified is terminal — no review affordance exists at all.
  expect(within(verifiedRow).queryByRole("button", { name: "Mark received" })).toBeNull();
  expect(within(verifiedRow).queryByRole("button", { name: "Verify" })).toBeNull();
  expect(within(verifiedRow).queryByRole("button", { name: "Reject" })).toBeNull();

  mocked.updateKycDocument.mockResolvedValue(pendingDoc({ status: "received", version: 2 }));
  await user.click(within(pendingRow).getByRole("button", { name: "Mark received" }));
  await waitFor(() => expect(mocked.updateKycDocument).toHaveBeenCalledTimes(1));
  const [memberIdArg, docIdArg, bodyArg] = mocked.updateKycDocument.mock.calls[0]!;
  expect(memberIdArg).toBe(MEMBER_ID);
  expect(docIdArg).toBe(DOC_ID_1);
  // Version-pinned single-purpose body: status only, expiry untouched
  // (exclude-unset semantics, review K2).
  expect(bodyArg).toEqual({ version: 1, status: "received" });
});

test("documents: a blank expiry is the EXPLICIT null clear (review K2); a denial is a sanitized single attempt", async () => {
  const user = userEvent.setup();
  mountScreen();
  const dialog = await openKycDrawer(user);

  // selector: the document-row label <span> — the person PROFILE also
  // renders a "KRA PIN" <dt> field label in the same dialog.
  await within(dialog).findByText("KRA PIN", { selector: "span" });
  const verifiedRow = within(dialog).getByText("KRA PIN", { selector: "span" }).closest("li")!;
  await user.click(within(verifiedRow).getByRole("button", { name: "Edit expiry" }));

  mocked.updateKycDocument.mockRejectedValue(new ApiError(403, "forbidden", "corr-403"));
  fireEvent.change(within(verifiedRow).getByLabelText(/Expiry/), { target: { value: "" } });
  await user.click(within(verifiedRow).getByRole("button", { name: "Save expiry" }));

  await waitFor(() => expect(mocked.updateKycDocument).toHaveBeenCalledTimes(1));
  expect(mocked.updateKycDocument.mock.calls[0]![2]).toEqual({ version: 2, expires_at: null });
  // Least disclosure: the standard sanitized title + ref; the raw
  // category never renders; under-privilege is NOT session death.
  expect(await within(dialog).findByText(/Not permitted\./)).toBeInTheDocument();
  expect(within(dialog).getByText(/ref: corr-403/)).toBeInTheDocument();
  expect(within(dialog).queryByText(/forbidden/i)).toBeNull();
  expect(hasSession()).toBe(true);
});

test("documents: 'not yet tracked' offers exactly the missing checklist types; tracking is ONE create", async () => {
  const user = userEvent.setup();
  mountScreen();
  const dialog = await openKycDrawer(user);

  await within(dialog).findByText("Not yet tracked");
  // person checklist minus the two tracked types (hand-computed).
  expect(within(dialog).getByRole("button", { name: "Track Passport photo" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Track Signature" })).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Track Next-of-kin ID" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).queryByRole("button", { name: "Track National ID copy" }),
  ).toBeNull();
  expect(within(dialog).queryByRole("button", { name: "Track KRA PIN" })).toBeNull();

  mocked.createKycDocument.mockResolvedValue(
    pendingDoc({ id: "dddddddd-1111-2222-3333-444444444444", doc_type: "passport_photo" }),
  );
  await user.click(within(dialog).getByRole("button", { name: "Track Passport photo" }));
  await waitFor(() => expect(mocked.createKycDocument).toHaveBeenCalledTimes(1));
  expect(mocked.createKycDocument.mock.calls[0]![1]).toEqual({ doc_type: "passport_photo" });
});

// ---------------------------------------------------------------------------
// Session teardown (W58-2 — production Providers wiring).
// ---------------------------------------------------------------------------

test("query-path 401 tears the session down", async () => {
  const user = userEvent.setup();
  mocked.fetchKycProfile.mockRejectedValue(new ApiError(401, "unauthenticated", "corr-q"));
  mountScreen();
  await openKycDrawer(user);
  await waitFor(() => expect(hasSession()).toBe(false), { timeout: 4000 });
});
