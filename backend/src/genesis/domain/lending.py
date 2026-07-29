"""Lending engine: single source of truth for loan math (MASTER_PROMPT 2.1).

Pure functions only: no I/O, no imports from other layers. Mirrors the
canonical prototype `inst()` and `classify()` semantics exactly. Money
rounding comes from `genesis.domain.money` (gate 1.1: reuse-first).
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from decimal import Decimal

from genesis.domain.money import ZERO, monthly_rate, to_cents


def installment_amount(principal: Decimal, annual_rate_pct: Decimal, months: int) -> Decimal:
    """Reducing-balance annuity installment, rounded to cents."""
    if months <= 0:
        raise ValueError("months must be positive")
    if principal <= 0:
        raise ValueError("principal must be positive")
    if annual_rate_pct < 0:
        raise ValueError("rate must not be negative")
    rate = monthly_rate(annual_rate_pct)
    if rate == 0:
        return to_cents(principal / months)
    factor = (1 + rate) ** months
    return to_cents(principal * rate * factor / (factor - 1))


@dataclass(frozen=True)
class ScheduledInstallment:
    number: int
    principal_due: Decimal
    interest_due: Decimal
    total_due: Decimal


def build_schedule(
    principal: Decimal, annual_rate_pct: Decimal, months: int
) -> list[ScheduledInstallment]:
    """Full amortization schedule.

    Invariants (property-tested):
    - sum(principal_due) == principal exactly
    - every total_due == principal_due + interest_due
    - len(schedule) == months
    The final installment absorbs cumulative rounding drift.
    """
    payment = installment_amount(principal, annual_rate_pct, months)
    rate = monthly_rate(annual_rate_pct)
    balance = to_cents(principal)
    schedule: list[ScheduledInstallment] = []
    for number in range(1, months + 1):
        interest = to_cents(balance * rate)
        if number == months:
            principal_part = balance
        else:
            principal_part = to_cents(payment - interest)
            if principal_part < 0:
                principal_part = ZERO
            if principal_part > balance:
                principal_part = balance
        total = to_cents(principal_part + interest)
        balance -= principal_part
        schedule.append(
            ScheduledInstallment(
                number=number,
                principal_due=principal_part,
                interest_due=interest,
                total_due=total,
            )
        )
    return schedule


class LoanClass(enum.StrEnum):
    NORMAL = "normal"
    WATCH = "watch"
    SUBSTANDARD = "substandard"
    DOUBTFUL = "doubtful"
    LOSS = "loss"


@dataclass(frozen=True)
class Classification:
    label: LoanClass
    provision_pct: Decimal
    is_npl: bool


def classify(days_past_due: int) -> Classification:
    """Prudential classification. Thresholds 30/90/180/360 days."""
    if days_past_due < 0:
        raise ValueError("days_past_due must not be negative")
    if days_past_due <= 30:
        return Classification(LoanClass.NORMAL, Decimal("1"), False)
    if days_past_due <= 90:
        return Classification(LoanClass.WATCH, Decimal("5"), False)
    if days_past_due <= 180:
        return Classification(LoanClass.SUBSTANDARD, Decimal("25"), True)
    if days_past_due <= 360:
        return Classification(LoanClass.DOUBTFUL, Decimal("50"), True)
    return Classification(LoanClass.LOSS, Decimal("100"), True)


class LoanStatus(enum.StrEnum):
    ACTIVE = "active"
    CLOSED = "closed"
    WRITTEN_OFF = "written_off"


_LOAN_ALLOWED: dict[LoanStatus, frozenset[LoanStatus]] = {
    LoanStatus.ACTIVE: frozenset({LoanStatus.CLOSED, LoanStatus.WRITTEN_OFF}),
    LoanStatus.CLOSED: frozenset(),
    LoanStatus.WRITTEN_OFF: frozenset(),
}


def loan_transition(current: LoanStatus, target: LoanStatus) -> LoanStatus:
    """The single gatekeeper for loan status changes (gate 1.4).

    CLOSED and WRITTEN_OFF are terminal; a closed loan can never be
    reopened — corrections happen through reversing ledger entries.
    """
    if target not in _LOAN_ALLOWED[current]:
        raise InvalidTransitionError(f"{current.value} -> {target.value}")
    return target


@dataclass(frozen=True)
class RepaymentAllocation:
    """One repayment split across the documented allocation order.

    Allocation order (P10 contract, single source of truth):
      1. penalties  — outstanding penalty charges are cleared first
      2. interest   — accrued unpaid interest on installments already due
      3. principal  — the remainder reduces the outstanding balance
    """

    penalties: Decimal
    interest: Decimal
    principal: Decimal

    @property
    def total(self) -> Decimal:
        return to_cents(self.penalties + self.interest + self.principal)


def allocate_repayment(
    amount: Decimal,
    *,
    penalties_due: Decimal,
    interest_due: Decimal,
    principal_outstanding: Decimal,
) -> RepaymentAllocation:
    """Split a repayment in the documented order penalties -> interest -> principal.

    Interest not yet due is never collected here: a payment beyond the
    due buckets prepays principal. Overpayment past the full payoff
    (penalties + due interest + principal) is rejected — the caller must
    collect at most the settlement quote.
    """
    amount = to_cents(amount)
    if amount <= ZERO:
        raise ValueError("repayment amount must be positive")
    if penalties_due < ZERO or interest_due < ZERO or principal_outstanding < ZERO:
        raise ValueError("due buckets must not be negative")
    payoff = penalties_due + interest_due + principal_outstanding
    if amount > payoff:
        raise ValueError(f"repayment {amount} exceeds full payoff {payoff}")
    penalties = min(amount, to_cents(penalties_due))
    remainder = amount - penalties
    interest = min(remainder, to_cents(interest_due))
    principal = to_cents(remainder - interest)
    return RepaymentAllocation(penalties=penalties, interest=interest, principal=principal)


@dataclass(frozen=True)
class SettlementQuote:
    """Early settlement payoff as of a date.

    Interest on installments not yet due is waived: settling early costs
    the outstanding principal plus interest already accrued (due) plus
    penalties — never future interest.
    """

    principal_balance: Decimal
    interest_due: Decimal
    penalties_due: Decimal

    @property
    def total(self) -> Decimal:
        return to_cents(self.principal_balance + self.interest_due + self.penalties_due)


def settlement_quote(
    principal_balance: Decimal,
    interest_due: Decimal,
    penalties_due: Decimal,
) -> SettlementQuote:
    """Build an early settlement quote from the three outstanding buckets."""
    if principal_balance < ZERO or interest_due < ZERO or penalties_due < ZERO:
        raise ValueError("settlement buckets must not be negative")
    return SettlementQuote(
        principal_balance=to_cents(principal_balance),
        interest_due=to_cents(interest_due),
        penalties_due=to_cents(penalties_due),
    )


class ApplicationStage(enum.StrEnum):
    SUBMITTED = "submitted"
    APPRAISAL = "appraisal"
    COMMITTEE = "committee"
    APPROVED = "approved"
    REJECTED = "rejected"
    DISBURSED = "disbursed"


class InvalidTransitionError(Exception):
    """Raised on any transition not in the allowed map (gate 1.4)."""


_ALLOWED: dict[ApplicationStage, frozenset[ApplicationStage]] = {
    ApplicationStage.SUBMITTED: frozenset({ApplicationStage.APPRAISAL, ApplicationStage.REJECTED}),
    ApplicationStage.APPRAISAL: frozenset({ApplicationStage.COMMITTEE, ApplicationStage.REJECTED}),
    ApplicationStage.COMMITTEE: frozenset({ApplicationStage.APPROVED, ApplicationStage.REJECTED}),
    ApplicationStage.APPROVED: frozenset({ApplicationStage.DISBURSED}),
    ApplicationStage.REJECTED: frozenset(),
    ApplicationStage.DISBURSED: frozenset(),
}


def allowed_transitions(current: ApplicationStage) -> frozenset[ApplicationStage]:
    return _ALLOWED[current]


def transition(current: ApplicationStage, target: ApplicationStage) -> ApplicationStage:
    """The single gatekeeper for application stage changes."""
    if target not in _ALLOWED[current]:
        raise InvalidTransitionError(f"{current.value} -> {target.value}")
    return target
