"""Lending engine: single source of truth for loan math (MASTER_PROMPT 2.1).

Pure functions only: no I/O, no imports from other layers. Mirrors the
canonical prototype `inst()` and `classify()` semantics exactly.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")


def _to_cents(value: Decimal) -> Decimal:
    """Round to 2 decimal places, half up. The only rounding used in lending."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def monthly_rate(annual_rate_pct: Decimal) -> Decimal:
    return annual_rate_pct / Decimal(100) / Decimal(12)


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
        return _to_cents(principal / months)
    factor = (1 + rate) ** months
    return _to_cents(principal * rate * factor / (factor - 1))


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
    balance = _to_cents(principal)
    schedule: list[ScheduledInstallment] = []
    for number in range(1, months + 1):
        interest = _to_cents(balance * rate)
        if number == months:
            principal_part = balance
        else:
            principal_part = _to_cents(payment - interest)
            if principal_part < 0:
                principal_part = Decimal("0.00")
            if principal_part > balance:
                principal_part = balance
        total = _to_cents(principal_part + interest)
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
