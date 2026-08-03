/**
 * ConfirmDangerModal proofs (P15 Phase B). Falsifiable: allow confirm
 * without the typed phrase, allow a near-miss/case-insensitive match,
 * drop the pending short-circuit, or render the phrase through a parser
 * sink and the matching test fails.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDangerModal } from "../components/ConfirmDangerModal";

function mount(props: Partial<Parameters<typeof ConfirmDangerModal>[0]> = {}) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  render(
    <ConfirmDangerModal
      title="Suspend user"
      confirmPhrase="GP-0001"
      confirmLabel="Suspend user"
      onConfirm={onConfirm}
      onClose={onClose}
      {...props}
    />,
  );
  return { onConfirm, onClose };
}

test("confirm stays disabled until the EXACT phrase is typed (case-sensitive)", async () => {
  const user = userEvent.setup();
  const { onConfirm } = mount();
  const confirm = screen.getByRole("button", { name: "Suspend user" });
  const input = screen.getByLabelText('Type "GP-0001" to confirm');

  expect(confirm).toBeDisabled();
  await user.type(input, "gp-0001"); // near miss: wrong case
  expect(confirm).toBeDisabled();
  await user.clear(input);
  await user.type(input, "GP-0001 "); // near miss: trailing space
  expect(confirm).toBeDisabled();
  await user.clear(input);
  await user.type(input, "GP-0001");
  expect(confirm).toBeEnabled();

  await user.click(confirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test("pending blocks re-confirmation AND every dismissal path", async () => {
  const user = userEvent.setup();
  const { onConfirm, onClose } = mount({ pending: true });

  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(onClose).not.toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

test("a hostile confirmation phrase renders as inert text (no sink)", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const { container } = ((): { container: HTMLElement } => {
    const onConfirm = jest.fn();
    return render(
      <ConfirmDangerModal
        title="Remove record"
        confirmPhrase={hostile}
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onClose={jest.fn()}
      />,
    );
  })();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getAllByText(hostile, { exact: false }).length).toBeGreaterThan(0);
});
