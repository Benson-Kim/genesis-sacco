import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ApiError } from "@genesis/api-client";
import { DashboardScreen } from "../components/DashboardScreen";
import { dashboardSummarySchema } from "../schemas";
import { fetchDashboardSummary } from "../api";
import { api } from "@/lib/api";

jest.mock("@/lib/api", () => ({
  api: { GET: jest.fn() },
}));

const mockGet = api.GET as unknown as jest.Mock;

/** Full-grant payload — every figure is a decimal STRING (hand-written). */
const FULL_SUMMARY = {
  as_of: "2026-08-03T08:00:00Z",
  members: {
    active_members: 412,
    by_type: [{ type: "person", total: 400, active: 390 }],
  },
  deposits: { total_deposits: "1234567.89", total_share_capital: "250000.00" },
  loan_book: {
    active_loans: 87,
    outstanding_balance: "5400000.00",
    npl_balance: "120000.00",
    npl_ratio_pct: "2.22",
    par30_balance: "300000.00",
    par30_ratio_pct: "5.56",
    provisions: "60000.00",
    penalties_due: "1500.00",
    by_classification: [
      { classification: "normal", count: 80, balance: "5100000.00", provisions: "51000.00" },
    ],
  },
  guarantors: null,
  monthly_flows: [{ month: "2026-07", deposits: "200000.00", disbursements: "150000.00" }],
  pipeline: [{ stage: "Review", count: 4 }],
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardScreen />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  mockGet.mockReset();
});

describe("dashboard contract (Zod — FM: contract-violation response)", () => {
  it("accepts the composite payload with omitted/null slices", () => {
    expect(dashboardSummarySchema.safeParse(FULL_SUMMARY).success).toBe(true);
    expect(dashboardSummarySchema.safeParse({ as_of: "2026-08-03T08:00:00Z" }).success).toBe(
      true,
    );
  });

  it("REJECTS numeric money values — amounts must stay strings", () => {
    const drifted = {
      ...FULL_SUMMARY,
      deposits: { total_deposits: 1234567.89, total_share_capital: "250000.00" },
    };
    expect(dashboardSummarySchema.safeParse(drifted).success).toBe(false);
  });

  it("fetchDashboardSummary throws (never returns) on a malformed body", async () => {
    mockGet.mockResolvedValue({
      data: { as_of: "2026-08-03", loan_book: { active_loans: "eighty-seven" } },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    await expect(fetchDashboardSummary()).rejects.toThrow();
  });
});

describe("DashboardScreen", () => {
  it("renders API decimal strings verbatim (grouped, never recomputed)", async () => {
    mockGet.mockResolvedValue({
      data: FULL_SUMMARY,
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    renderScreen();
    // Oracle: fmtAmount("1234567.89") = "1,234,567.89" (hand-grouped).
    expect(await screen.findByText("KES 1,234,567.89")).toBeInTheDocument();
    expect(screen.getByText("KES 5,400,000.00")).toBeInTheDocument();
    expect(screen.getByText("5.56%")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("renders em-dashes for ungranted slices — no fabricated figures", async () => {
    mockGet.mockResolvedValue({
      data: { as_of: "2026-08-03T08:00:00Z" },
      error: undefined,
      response: new Response(null, { status: 200 }),
    });
    renderScreen();
    const dashes = await screen.findAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("Application pipeline")).not.toBeInTheDocument();
    expect(screen.queryByText("Monthly flows")).not.toBeInTheDocument();
  });

  it("surfaces 403 as the least-disclosure banner (API is the enforcer)", async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { category: "forbidden", correlation_id: "corr-7" },
      response: new Response(null, { status: 403 }),
    });
    renderScreen();
    expect(await screen.findByRole("alert")).toHaveTextContent("Not permitted.");
    expect(screen.getByRole("alert")).toHaveTextContent("corr-7");
    // No figures, no capability hints beyond the sanitized title.
    expect(screen.queryByText(/KES/)).not.toBeInTheDocument();
  });

  it("maps unparseable error bodies to a generic message (no internals)", async () => {
    mockGet.mockResolvedValue({
      data: undefined,
      error: { detail: "TraceBack: secret internals" },
      response: new Response(null, { status: 500 }),
    });
    renderScreen();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).not.toHaveTextContent("secret internals");
    expect(new ApiError(500, "internal_error", null).category).toBe("internal_error");
  });
});

