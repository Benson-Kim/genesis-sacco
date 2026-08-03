/**
 * Credit-committee adversarial tests THROUGH THE REAL SCREEN CODE (P15
 * Applications/Committee batch). The centrepiece is SEPARATION OF
 * DUTIES, proven STRUCTURALLY (not cosmetically): the vote affordances
 * mount only inside MakerCheckerPanel, which withholds them whenever
 * the signed-in principal is the witnessed maker or cannot be
 * established at all — there is no prop or code path a screen could use
 * to override it. The server enforces the invariants regardless
 * (one vote per voter via DB UNIQUE, committee-stage-only voting,
 * authority bands); these tests pin the UI so it never offers what the
 * API forbids.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@genesis/api-client";
import { Providers } from "@/app/providers";
import { clearSession, hasSession, setSession } from "@/modules/auth/session";
import { usePermissions } from "@/modules/authz/usePermissions";
import { CommitteeScreen } from "../components/CommitteeScreen";
import { clearCommitteeMakers, recordCommitteeMaker } from "../makerRegistry";
import { voteResultSchema, type Application, type VoteResult } from "../schemas";
import * as appsApi from "../api";
import * as membersApi from "@/modules/members/api";

jest.mock("../api", () => {
  const actual = jest.requireActual<typeof import("../api")>("../api");
  return {
    ...actual,
    fetchApplicationsPage: jest.fn(),
    fetchApplication: jest.fn(),
    fetchProducts: jest.fn(),
    createApplication: jest.fn(),
    transitionApplication: jest.fn(),
    voteOnApplication: jest.fn(),
  };
});

jest.mock("@/modules/members/api", () => ({
  fetchMembersPage: jest.fn(),
  fetchMember: jest.fn(),
}));

jest.mock("@/modules/authz/usePermissions", () => ({
  usePermissions: jest.fn(),
}));

const mocked = jest.mocked(appsApi);
const mockedMembers = jest.mocked(membersApi);
const mockedPermissions = jest.mocked(usePermissions);

const VOTER_ID = "99999999-9999-9999-9999-999999999999";
const OTHER_OFFICER_ID = "88888888-8888-8888-8888-888888888888";
const MEMBER_ID = "11111111-1111-1111-1111-111111111111";
const PRODUCT_ID = "44444444-4444-4444-4444-444444444444";
const APP_ID = "aaaaaaaa-1111-2222-3333-444444444444";

const HOSTILE_PURPOSE = "<script>window.__pwned=1</script> land purchase";

function b64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function fakeJwt(claims: object): string {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${b64url({ alg: "HS256" })}.${b64url({ ...claims, exp })}.sig`;
}

function committeeApp(overrides: Partial<Application> = {}): Application {
  return {
    id: APP_ID,
    member_id: MEMBER_ID,
    product_id: PRODUCT_ID,
    amount: "500000.00",
    term_months: 36,
    rate_pct: "14.00",
    purpose: "Business stock",
    stage: "committee",
    cover_pct: "95.50",
    max_eligible: null,
    version: 7,
    ...overrides,
  };
}

const MEMBER = {
  id: MEMBER_ID,
  member_no: "M-0001",
  type: "person" as const,
  name: "Jane Wanjiku",
  phone: null,
  email: null,
  status: "active" as const,
  version: 1,
};

const APPROVER_PERMS = {
  role_id: VOTER_ID,
  permissions: [
    {
      module: "applications",
      can_view: true,
      can_create: false,
      can_edit: false,
      can_approve: true,
    },
  ],
};

const NO_APPROVE_PERMS = {
  role_id: VOTER_ID,
  permissions: [
    {
      module: "applications",
      can_view: true,
      can_create: true,
      can_edit: true,
      can_approve: false,
    },
  ],
};

function grantPermissions(perms: typeof APPROVER_PERMS) {
  mockedPermissions.mockReturnValue({
    data: perms,
    isPending: false,
    isError: false,
  } as unknown as ReturnType<typeof usePermissions>);
}

function mountScreen() {
  return render(
    <Providers>
      <CommitteeScreen />
    </Providers>,
  );
}

const TALLY_OPEN: VoteResult = {
  approvals: 1,
  rejections: 0,
  decision: null,
  stage: "committee",
};

beforeEach(() => {
  jest.clearAllMocks();
  clearCommitteeMakers();
  clearSession();
  setSession({ accessToken: fakeJwt({ sub: VOTER_ID }), refreshToken: "refresh-1" });
  grantPermissions(APPROVER_PERMS);
  mocked.fetchApplicationsPage.mockResolvedValue({
    items: [committeeApp()],
    nextCursor: null,
  });
  mocked.fetchApplication.mockResolvedValue(committeeApp());
  mocked.fetchProducts.mockResolvedValue([]);
  mockedMembers.fetchMember.mockResolvedValue(MEMBER);
});

afterEach(() => {
  clearSession();
});

test("SEPARATION OF DUTIES (structural): the operator who recommended to committee gets NO vote affordances — even with an approve grant", async () => {
  // This tab witnessed the signed-in operator making the referral.
  recordCommitteeMaker(APP_ID, VOTER_ID);
  mountScreen();

  await screen.findByText(/Loan review/);
  // The SoD banner explains the structural denial…
  expect(
    await screen.findByText(/Approval requires a DIFFERENT\s+administrator/),
  ).toBeInTheDocument();
  // …and the vote buttons simply do not exist in the DOM (not merely
  // disabled — MakerCheckerPanel never mounts checkerActions for the
  // maker; there is no override prop to bypass it).
  expect(screen.queryByRole("button", { name: "Vote approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Vote reject" })).toBeNull();
  expect(mocked.voteOnApplication).not.toHaveBeenCalled();
});

test("SEPARATION OF DUTIES (deny by default): an unestablishable checker identity gets NO vote affordances", async () => {
  // A session token WITHOUT a sub claim: getOwnUserId() === null.
  clearSession();
  setSession({ accessToken: fakeJwt({}), refreshToken: "refresh-2" });
  recordCommitteeMaker(APP_ID, OTHER_OFFICER_ID);
  mountScreen();

  await screen.findByText(/Loan review/);
  expect(
    await screen.findByText(/Checker identity could not be established/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Vote approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Vote reject" })).toBeNull();
});

test("an eligible checker (different known principal) votes ONCE through the confirmation; the tally renders COUNTS only", async () => {
  const user = userEvent.setup();
  recordCommitteeMaker(APP_ID, OTHER_OFFICER_ID);
  let release: (value: VoteResult) => void = () => undefined;
  mocked.voteOnApplication.mockImplementation(
    () =>
      new Promise<VoteResult>((resolve) => {
        release = resolve;
      }),
  );
  mountScreen();

  await user.click(await screen.findByRole("button", { name: "Vote approve" }));
  const confirm = await screen.findByRole("button", { name: "Confirm approve vote" });

  // Double-click the confirmation: the pending short-circuit yields ONE call.
  await user.click(confirm);
  await user.click(confirm);
  expect(mocked.voteOnApplication).toHaveBeenCalledTimes(1);
  expect(mocked.voteOnApplication.mock.calls[0]?.[0]).toBe(APP_ID);
  expect(mocked.voteOnApplication.mock.calls[0]?.[1]).toBe("approve");

  release(TALLY_OPEN);
  expect(await screen.findByText("1 approve")).toBeInTheDocument();
  expect(screen.getByText("0 reject")).toBeInTheDocument();
  expect(screen.getByText("Awaiting quorum")).toBeInTheDocument();
  // After a recorded vote the buttons are spent (one vote per member).
  expect(screen.getByRole("button", { name: "Vote approve" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Vote reject" })).toBeDisabled();
});

test("a quorum decision renders from the SERVER verdict — nothing tallied client-side", async () => {
  const user = userEvent.setup();
  recordCommitteeMaker(APP_ID, OTHER_OFFICER_ID);
  mocked.voteOnApplication.mockResolvedValue({
    approvals: 3,
    rejections: 1,
    decision: "approved",
    stage: "approved",
  });
  mountScreen();

  await user.click(await screen.findByRole("button", { name: "Vote approve" }));
  await user.click(await screen.findByRole("button", { name: "Confirm approve vote" }));

  expect(await screen.findByText("Decision: approved")).toBeInTheDocument();
  expect(screen.getByText("3 approve")).toBeInTheDocument();
  expect(screen.getByText("1 reject")).toBeInTheDocument();
});

test("already-voted / stage-moved: 409 shows the explicit reload flow with EXACTLY ONE attempt; reload never replays the vote", async () => {
  const user = userEvent.setup();
  recordCommitteeMaker(APP_ID, OTHER_OFFICER_ID);
  mocked.voteOnApplication.mockRejectedValue(new ApiError(409, "conflict", "corr-voted"));
  mountScreen();

  await user.click(await screen.findByRole("button", { name: "Vote reject" }));
  await user.click(await screen.findByRole("button", { name: "Confirm reject vote" }));

  expect(await screen.findByText(/Your change was NOT applied/)).toBeInTheDocument();
  expect(mocked.voteOnApplication).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Reload record" }));
  await waitFor(() => expect(mocked.fetchApplication).toHaveBeenCalledTimes(2));
  // The vote is NEVER replayed by the reload.
  expect(mocked.voteOnApplication).toHaveBeenCalledTimes(1);
});

test("no applications:approve grant ⇒ vote controls are not offered even to an eligible checker", async () => {
  grantPermissions(NO_APPROVE_PERMS);
  recordCommitteeMaker(APP_ID, OTHER_OFFICER_ID);
  mountScreen();

  await screen.findByText(/Loan review/);
  expect(
    await screen.findByText(/no committee approval permission/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Vote approve" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Vote reject" })).toBeNull();
});

test("hostile purpose renders as inert TEXT on the agenda and review panel (named XSS threat)", async () => {
  mocked.fetchApplicationsPage.mockResolvedValue({
    items: [committeeApp({ purpose: HOSTILE_PURPOSE })],
    nextCursor: null,
  });
  mocked.fetchApplication.mockResolvedValue(committeeApp({ purpose: HOSTILE_PURPOSE }));
  const { container } = mountScreen();

  const occurrences = await screen.findAllByText(new RegExp("window.__pwned"));
  expect(occurrences.length).toBeGreaterThan(0);
  expect(container.querySelector("script")).toBeNull();
  expect((window as { __pwned?: unknown }).__pwned).toBeUndefined();
});

test("least-disclosure: a 403 on the vote renders the sanitized banner only, session intact", async () => {
  const user = userEvent.setup();
  recordCommitteeMaker(APP_ID, OTHER_OFFICER_ID);
  mocked.voteOnApplication.mockRejectedValue(new ApiError(403, "forbidden", "corr-f"));
  mountScreen();

  await user.click(await screen.findByRole("button", { name: "Vote approve" }));
  await user.click(await screen.findByRole("button", { name: "Confirm approve vote" }));

  expect(await screen.findByText(/Not permitted\./)).toBeInTheDocument();
  expect(screen.getByText(/ref: corr-f/)).toBeInTheDocument();
  expect(screen.queryByText(/forbidden/i)).toBeNull();
  expect(screen.queryByRole("button", { name: "Reload record" })).toBeNull();
  expect(mocked.voteOnApplication).toHaveBeenCalledTimes(1);
  expect(hasSession()).toBe(true);
});

test("query-path 401 tears the session down immediately (dual-cache teardown)", async () => {
  mocked.fetchApplicationsPage.mockRejectedValue(new ApiError(401, "unauthenticated", "corr-q"));
  mountScreen();

  await waitFor(() => expect(hasSession()).toBe(false), { timeout: 4000 });
});

test("Zod boundary: the tally is COUNTS + decision only — a payload leaking voter identities is a contract violation", () => {
  expect(voteResultSchema.safeParse(TALLY_OPEN).success).toBe(true);
  // Numbers-as-strings (or any shape drift) fail the boundary.
  expect(
    voteResultSchema.safeParse({ ...TALLY_OPEN, approvals: "1" }).success,
  ).toBe(false);
  // Extra keys are STRIPPED at the boundary: even if a future backend
  // leaked voter identities, the parsed output carries only
  // counts/decision/stage — nothing else can reach the DOM.
  const parsed = voteResultSchema.parse({ ...TALLY_OPEN, voters: ["someone"] });
  expect(parsed).toEqual(TALLY_OPEN);
});
