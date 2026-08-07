/**
 * #31 ledger (h5), OTP side — paste and IME-composition hygiene of the
 * LoginGate 6-digit code entry, through the REAL screen code.
 *
 * Falsifiable proofs:
 * - a full-code PASTE into one digit box never fans out across boxes
 *   (each box owns exactly ONE keyboard-truth digit; maxLength=1 +
 *   the last-char reducer) — submit refuses with the inline error and
 *   NOTHING reaches the wire;
 * - IME-composed NON-ASCII digits (full-width ６ etc.) are stripped by
 *   the \D reducer — the box stays empty, zero wire calls;
 * - honest typed ASCII digits still verify (hygiene is exactness, not
 *   lockout) with exactly ONE verify POST.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginGate } from "../components/LoginGate";
import * as authApi from "../api";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

jest.mock("../api", () => ({
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

const mocked = jest.mocked(authApi);

function mountGate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LoginGate />
    </QueryClientProvider>,
  );
}

/** Drive the request stage to reach the 6-digit verify stage. */
async function reachVerifyStage(user: ReturnType<typeof userEvent.setup>) {
  mocked.requestOtp.mockResolvedValue(undefined as never);
  mountGate();
  await user.type(screen.getByLabelText("Email"), "teller@sacco.co.ke");
  await user.click(screen.getByRole("button", { name: "Send OTP" }));
  await screen.findByLabelText("Digit 1");
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("full-code PASTE into Digit 1 never fans out: one box, one digit; submit refuses inline and ZERO verify calls leave", async () => {
  const user = userEvent.setup();
  await reachVerifyStage(user);

  const first = screen.getByLabelText("Digit 1");
  await user.click(first);
  await user.paste("123456");

  // maxLength=1 admits one character; the reducer keeps a single
  // digit — the remaining boxes stay EMPTY (nothing fans out).
  expect((first as HTMLInputElement).value).toHaveLength(1);
  for (let index = 2; index <= 6; index += 1) {
    expect(screen.getByLabelText(`Digit ${index}`)).toHaveValue("");
  }

  await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
  expect(await screen.findByText("Enter all 6 digits.")).toBeInTheDocument();
  expect(mocked.verifyOtp).not.toHaveBeenCalled();
});

test("IME-composed full-width digits are stripped by the \\D reducer: the box stays empty, submit refuses, ZERO verify calls", async () => {
  const user = userEvent.setup();
  await reachVerifyStage(user);

  const first = screen.getByLabelText("Digit 1");
  // Simulate an East-Asian IME committing FULLWIDTH DIGIT SIX
  // (U+FF16): composition events bracket a change whose value is the
  // composed non-ASCII code point.
  fireEvent.compositionStart(first);
  fireEvent.change(first, { target: { value: "\uFF16" } });
  fireEvent.compositionEnd(first, { data: "\uFF16" });
  expect(first).toHaveValue("");

  // A composed CJK character is equally inert.
  fireEvent.compositionStart(first);
  fireEvent.change(first, { target: { value: "六" } });
  fireEvent.compositionEnd(first, { data: "六" });
  expect(first).toHaveValue("");

  await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
  expect(await screen.findByText("Enter all 6 digits.")).toBeInTheDocument();
  expect(mocked.verifyOtp).not.toHaveBeenCalled();
});

test("honest ASCII digits still verify with exactly ONE wire call (hygiene is exactness, not lockout)", async () => {
  const user = userEvent.setup();
  let release: (value: never) => void = () => undefined;
  mocked.verifyOtp.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve as (value: never) => void;
      }),
  );
  await reachVerifyStage(user);

  for (let index = 1; index <= 6; index += 1) {
    await user.type(screen.getByLabelText(`Digit ${index}`), String(index));
  }
  await user.click(screen.getByRole("button", { name: "Verify & sign in" }));
  expect(mocked.verifyOtp).toHaveBeenCalledTimes(1);
  expect(mocked.verifyOtp.mock.calls[0]?.[0]).toMatchObject({
    email: "teller@sacco.co.ke",
    code: "123456",
  });
  release(undefined as never);
});
