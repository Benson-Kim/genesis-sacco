# ruff: noqa: I001
"""Unit tests for genesis.domain.ledger — pure, no I/O (P7 gate 1.5)."""

from decimal import Decimal

import pytest

from genesis.domain.ledger import (
    Account,
    Channel,
    LedgerLine,
    PostingSpec,
    Side,
    TxnType,
    build_deposit_posting,
    build_disbursement_posting,
    build_interest_posting,
    build_repayment_posting,
    build_reversal_posting,
    build_share_topup_posting,
    build_withdrawal_posting,
    ref_prefix,
)


# ---------------------------------------------------------------------------
# LedgerLine validation
# ---------------------------------------------------------------------------


def test_ledger_line_rejects_zero_amount() -> None:
    with pytest.raises(ValueError, match="positive"):
        LedgerLine(account=Account.CASH_MPESA, side=Side.DEBIT, amount=Decimal("0"))


def test_ledger_line_rejects_negative_amount() -> None:
    with pytest.raises(ValueError, match="positive"):
        LedgerLine(account=Account.CASH_MPESA, side=Side.DEBIT, amount=Decimal("-1"))


# ---------------------------------------------------------------------------
# PostingSpec validation
# ---------------------------------------------------------------------------


def test_posting_spec_rejects_zero_amount() -> None:
    with pytest.raises(ValueError, match="positive"):
        PostingSpec(
            txn_type=TxnType.DEPOSIT,
            channel=Channel.MPESA,
            amount=Decimal("0"),
            lines=(
                LedgerLine(Account.CASH_MPESA, Side.DEBIT, Decimal("100")),
                LedgerLine(Account.MEMBER_DEPOSITS, Side.CREDIT, Decimal("100")),
            ),
        )


def test_posting_spec_rejects_empty_lines() -> None:
    with pytest.raises(ValueError, match="at least one line"):
        PostingSpec(
            txn_type=TxnType.DEPOSIT,
            channel=Channel.MPESA,
            amount=Decimal("100"),
            lines=(),
        )


def test_assert_balanced_raises_on_imbalance() -> None:
    spec = PostingSpec(
        txn_type=TxnType.DEPOSIT,
        channel=Channel.MPESA,
        amount=Decimal("100"),
        lines=(
            LedgerLine(Account.CASH_MPESA, Side.DEBIT, Decimal("100")),
            LedgerLine(Account.MEMBER_DEPOSITS, Side.CREDIT, Decimal("99")),
        ),
    )
    with pytest.raises(ValueError, match="Unbalanced"):
        spec.assert_balanced()


# ---------------------------------------------------------------------------
# Posting factory functions — balance invariant
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "channel",
    [Channel.MPESA, Channel.BANK],
)
def test_deposit_posting_is_balanced(channel: Channel) -> None:
    build_deposit_posting(Decimal("5000.00"), channel).assert_balanced()


@pytest.mark.parametrize(
    "channel",
    [Channel.MPESA, Channel.BANK],
)
def test_withdrawal_posting_is_balanced(channel: Channel) -> None:
    build_withdrawal_posting(Decimal("5000.00"), channel).assert_balanced()


def test_share_topup_posting_is_balanced() -> None:
    build_share_topup_posting(Decimal("5000.00"), Channel.MPESA).assert_balanced()


def test_disbursement_posting_is_balanced() -> None:
    build_disbursement_posting(Decimal("5000.00"), Channel.BANK).assert_balanced()


def test_repayment_posting_is_balanced() -> None:
    build_repayment_posting(Decimal("5000.00"), Channel.MPESA).assert_balanced()


def test_interest_posting_is_balanced() -> None:
    spec = build_interest_posting(Decimal("250.50"))
    spec.assert_balanced()


# ---------------------------------------------------------------------------
# Deposit posting — correct accounts
# ---------------------------------------------------------------------------


def test_deposit_mpesa_uses_cash_mpesa() -> None:
    spec = build_deposit_posting(Decimal("1000"), Channel.MPESA)
    dr = [ln for ln in spec.lines if ln.side is Side.DEBIT]
    cr = [ln for ln in spec.lines if ln.side is Side.CREDIT]
    assert dr[0].account is Account.CASH_MPESA
    assert cr[0].account is Account.MEMBER_DEPOSITS


def test_deposit_bank_uses_cash_bank() -> None:
    spec = build_deposit_posting(Decimal("1000"), Channel.BANK)
    dr = [ln for ln in spec.lines if ln.side is Side.DEBIT]
    assert dr[0].account is Account.CASH_BANK


# ---------------------------------------------------------------------------
# Disbursement posting — correct accounts
# ---------------------------------------------------------------------------


def test_disbursement_dr_loans_receivable() -> None:
    spec = build_disbursement_posting(Decimal("50000"), Channel.BANK)
    dr = [ln for ln in spec.lines if ln.side is Side.DEBIT]
    cr = [ln for ln in spec.lines if ln.side is Side.CREDIT]
    assert dr[0].account is Account.LOANS_RECEIVABLE
    assert cr[0].account is Account.CASH_BANK


# ---------------------------------------------------------------------------
# Reversal posting
# ---------------------------------------------------------------------------


def test_reversal_flips_sides_and_is_balanced() -> None:
    original = build_deposit_posting(Decimal("2000"), Channel.MPESA)
    reversal = build_reversal_posting(original)
    reversal.assert_balanced()
    # Every line's side should be flipped.
    for orig_ln, rev_ln in zip(original.lines, reversal.lines, strict=True):
        assert orig_ln.account == rev_ln.account
        assert orig_ln.amount == rev_ln.amount
        assert orig_ln.side != rev_ln.side


def test_reversal_of_reversal_equals_original() -> None:
    original = build_deposit_posting(Decimal("3000"), Channel.BANK)
    double_reversal = build_reversal_posting(build_reversal_posting(original))
    assert double_reversal.lines == original.lines


# ---------------------------------------------------------------------------
# Reference prefix mapping
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "txn_type,channel,expected_prefix",
    [
        (TxnType.DEPOSIT, Channel.MPESA, "MP-"),
        (TxnType.DEPOSIT, Channel.BANK, "WD-"),
        (TxnType.WITHDRAWAL, Channel.MPESA, "WD-"),
        (TxnType.WITHDRAWAL, Channel.BANK, "WD-"),
        (TxnType.SHARE_TOPUP, Channel.MPESA, "SH-"),
        (TxnType.LOAN_DISBURSEMENT, Channel.BANK, "LN-"),
        (TxnType.LOAN_REPAYMENT, Channel.MPESA, "RP-"),
        (TxnType.INTEREST_POSTING, Channel.ACCRUAL, "INT-"),
    ],
)
def test_ref_prefix_mapping(txn_type: TxnType, channel: Channel, expected_prefix: str) -> None:
    assert ref_prefix(txn_type, channel) == expected_prefix


# ---------------------------------------------------------------------------
# Money rounding — amounts are always 2 d.p.
# ---------------------------------------------------------------------------


def test_deposit_amount_rounded_to_cents() -> None:
    spec = build_deposit_posting(Decimal("999.999"), Channel.MPESA)
    assert spec.amount == Decimal("1000.00")
    for ln in spec.lines:
        assert ln.amount == Decimal("1000.00")
