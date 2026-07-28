"""Double-entry ledger domain: pure types, account chart, and posting rules.

Zero I/O — no imports from application, infrastructure, or api layers.
Money rounding comes from genesis.domain.money (gate 1.1: reuse-first).

Every posting is a balanced set of LedgerLine pairs (DR == CR).
Corrections are reversing entries only — UPDATE/DELETE are forbidden by
DB trigger (gate 1.5).

Reference prefixes (gate 1.4):
  MP-  M-Pesa deposit / withdrawal
  LN-  Loan disbursement
  RP-  Loan repayment
  SH-  Share top-up
  WD-  Withdrawal (bank)
  INT- Interest accrual posting
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from decimal import Decimal

from genesis.domain.money import ZERO, to_cents


# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class TxnType(enum.StrEnum):
    DEPOSIT = "deposit"
    WITHDRAWAL = "withdrawal"
    SHARE_TOPUP = "share_topup"
    LOAN_DISBURSEMENT = "loan_disbursement"
    LOAN_REPAYMENT = "loan_repayment"
    INTEREST_POSTING = "interest_posting"
    EXIT_SETTLEMENT = "exit_settlement"


class Channel(enum.StrEnum):
    MPESA = "mpesa"
    BANK = "bank"
    ACCRUAL = "accrual"
    INTERNAL = "internal"


class Side(enum.StrEnum):
    DEBIT = "debit"
    CREDIT = "credit"


# ---------------------------------------------------------------------------
# Chart of accounts (symbolic names; stored as text in the DB)
# ---------------------------------------------------------------------------


class Account(enum.StrEnum):
    # Asset accounts
    CASH_MPESA = "cash.mpesa"
    CASH_BANK = "cash.bank"
    LOANS_RECEIVABLE = "loans.receivable"

    # Liability accounts
    MEMBER_DEPOSITS = "member.deposits"
    MEMBER_SHARES = "member.shares"

    # Income accounts
    INTEREST_INCOME = "income.interest"

    # Suspense / clearing
    SUSPENSE = "suspense"


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LedgerLine:
    """One leg of a double-entry posting."""

    account: Account
    side: Side
    amount: Decimal

    def __post_init__(self) -> None:
        if self.amount <= ZERO:
            raise ValueError(f"LedgerLine amount must be positive, got {self.amount!r}")


@dataclass(frozen=True)
class PostingSpec:
    """A balanced set of ledger lines for one transaction.

    Invariant: sum(DR amounts) == sum(CR amounts).
    Validated by assert_balanced(); the DB trigger enforces this too.
    """

    txn_type: TxnType
    channel: Channel
    amount: Decimal
    lines: tuple[LedgerLine, ...]

    def __post_init__(self) -> None:
        if self.amount <= ZERO:
            raise ValueError(f"PostingSpec amount must be positive, got {self.amount!r}")
        if not self.lines:
            raise ValueError("PostingSpec must have at least one line")

    def assert_balanced(self) -> None:
        """Raise if DR total != CR total (gate 1.5)."""
        dr = sum((ln.amount for ln in self.lines if ln.side is Side.DEBIT), ZERO)
        cr = sum((ln.amount for ln in self.lines if ln.side is Side.CREDIT), ZERO)
        if dr != cr:
            raise ValueError(
                f"Unbalanced posting: DR={dr} CR={cr} diff={dr - cr}"
            )


# ---------------------------------------------------------------------------
# Reference prefix registry
# ---------------------------------------------------------------------------

REF_PREFIX: dict[TxnType, str] = {
    TxnType.DEPOSIT: "MP-",          # M-Pesa deposit (also used for bank via channel)
    TxnType.WITHDRAWAL: "WD-",
    TxnType.SHARE_TOPUP: "SH-",
    TxnType.LOAN_DISBURSEMENT: "LN-",
    TxnType.LOAN_REPAYMENT: "RP-",
    TxnType.INTEREST_POSTING: "INT-",
    TxnType.EXIT_SETTLEMENT: "WD-",  # exit settlement is a withdrawal variant
}

# Channel-specific prefix override for deposits
_DEPOSIT_CHANNEL_PREFIX: dict[Channel, str] = {
    Channel.MPESA: "MP-",
    Channel.BANK: "WD-",   # bank deposit uses WD- per spec (bank channel)
    Channel.ACCRUAL: "INT-",
    Channel.INTERNAL: "WD-",
}


def ref_prefix(txn_type: TxnType, channel: Channel) -> str:
    """Return the reference prefix for a given transaction type and channel."""
    if txn_type is TxnType.DEPOSIT:
        return _DEPOSIT_CHANNEL_PREFIX.get(channel, "MP-")
    return REF_PREFIX[txn_type]


# ---------------------------------------------------------------------------
# Posting factory functions (pure — no I/O)
# ---------------------------------------------------------------------------


def _cash_account(channel: Channel) -> Account:
    if channel is Channel.MPESA:
        return Account.CASH_MPESA
    if channel is Channel.BANK:
        return Account.CASH_BANK
    # Accrual / internal postings use suspense
    return Account.SUSPENSE


def build_deposit_posting(amount: Decimal, channel: Channel) -> PostingSpec:
    """DR cash / CR member deposits."""
    amt = to_cents(amount)
    return PostingSpec(
        txn_type=TxnType.DEPOSIT,
        channel=channel,
        amount=amt,
        lines=(
            LedgerLine(account=_cash_account(channel), side=Side.DEBIT, amount=amt),
            LedgerLine(account=Account.MEMBER_DEPOSITS, side=Side.CREDIT, amount=amt),
        ),
    )


def build_withdrawal_posting(amount: Decimal, channel: Channel) -> PostingSpec:
    """DR member deposits / CR cash."""
    amt = to_cents(amount)
    return PostingSpec(
        txn_type=TxnType.WITHDRAWAL,
        channel=channel,
        amount=amt,
        lines=(
            LedgerLine(account=Account.MEMBER_DEPOSITS, side=Side.DEBIT, amount=amt),
            LedgerLine(account=_cash_account(channel), side=Side.CREDIT, amount=amt),
        ),
    )


def build_share_topup_posting(amount: Decimal, channel: Channel) -> PostingSpec:
    """DR cash / CR member shares."""
    amt = to_cents(amount)
    return PostingSpec(
        txn_type=TxnType.SHARE_TOPUP,
        channel=channel,
        amount=amt,
        lines=(
            LedgerLine(account=_cash_account(channel), side=Side.DEBIT, amount=amt),
            LedgerLine(account=Account.MEMBER_SHARES, side=Side.CREDIT, amount=amt),
        ),
    )


def build_disbursement_posting(amount: Decimal, channel: Channel) -> PostingSpec:
    """DR loans receivable / CR cash (funds leave the SACCO)."""
    amt = to_cents(amount)
    return PostingSpec(
        txn_type=TxnType.LOAN_DISBURSEMENT,
        channel=channel,
        amount=amt,
        lines=(
            LedgerLine(account=Account.LOANS_RECEIVABLE, side=Side.DEBIT, amount=amt),
            LedgerLine(account=_cash_account(channel), side=Side.CREDIT, amount=amt),
        ),
    )


def build_repayment_posting(amount: Decimal, channel: Channel) -> PostingSpec:
    """DR cash / CR loans receivable."""
    amt = to_cents(amount)
    return PostingSpec(
        txn_type=TxnType.LOAN_REPAYMENT,
        channel=channel,
        amount=amt,
        lines=(
            LedgerLine(account=_cash_account(channel), side=Side.DEBIT, amount=amt),
            LedgerLine(account=Account.LOANS_RECEIVABLE, side=Side.CREDIT, amount=amt),
        ),
    )


def build_interest_posting(amount: Decimal) -> PostingSpec:
    """DR suspense (accrual) / CR interest income."""
    amt = to_cents(amount)
    return PostingSpec(
        txn_type=TxnType.INTEREST_POSTING,
        channel=Channel.ACCRUAL,
        amount=amt,
        lines=(
            LedgerLine(account=Account.SUSPENSE, side=Side.DEBIT, amount=amt),
            LedgerLine(account=Account.INTEREST_INCOME, side=Side.CREDIT, amount=amt),
        ),
    )


def build_reversal_posting(original: PostingSpec) -> PostingSpec:
    """Return a reversing entry that exactly negates the original (gate 1.5).

    Each line's side is flipped; the amount and accounts are unchanged.
    The resulting PostingSpec is balanced by construction.
    """
    reversed_lines = tuple(
        LedgerLine(
            account=ln.account,
            side=Side.CREDIT if ln.side is Side.DEBIT else Side.DEBIT,
            amount=ln.amount,
        )
        for ln in original.lines
    )
    return PostingSpec(
        txn_type=original.txn_type,
        channel=original.channel,
        amount=original.amount,
        lines=reversed_lines,
    )
