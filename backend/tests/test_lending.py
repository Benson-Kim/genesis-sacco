from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from genesis.domain.lending import (
    ApplicationStage,
    InvalidTransitionError,
    LoanClass,
    LoanStatus,
    allocate_repayment,
    allowed_transitions,
    build_schedule,
    classify,
    installment_amount,
    loan_transition,
    settlement_quote,
    transition,
)

principals = st.decimals(
    min_value=Decimal("1000"),
    max_value=Decimal("10000000"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
rates = st.decimals(
    min_value=Decimal("0"),
    max_value=Decimal("36"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
terms = st.integers(min_value=1, max_value=120)


@given(principal=principals, rate=rates, months=terms)
def test_schedule_invariants(principal: Decimal, rate: Decimal, months: int) -> None:
    schedule = build_schedule(principal, rate, months)
    assert len(schedule) == months
    assert sum(item.principal_due for item in schedule) == principal
    for item in schedule:
        assert item.interest_due >= 0
        assert item.principal_due >= 0
        assert item.total_due == item.principal_due + item.interest_due


def test_installment_matches_prototype_formula() -> None:
    principal, annual, months = 260000.0, 12.0, 36
    monthly = annual / 100 / 12
    factor = (1 + monthly) ** months
    expected = round(principal * monthly * factor / (factor - 1), 2)
    got = installment_amount(Decimal("260000"), Decimal("12"), 36)
    assert abs(float(got) - expected) < 0.01


def test_zero_rate_is_straight_line() -> None:
    schedule = build_schedule(Decimal("1200"), Decimal("0"), 12)
    assert all(item.interest_due == 0 for item in schedule)
    assert sum(item.principal_due for item in schedule) == Decimal("1200")


@pytest.mark.parametrize(
    ("days", "label", "provision", "npl"),
    [
        (0, LoanClass.NORMAL, "1", False),
        (30, LoanClass.NORMAL, "1", False),
        (31, LoanClass.WATCH, "5", False),
        (90, LoanClass.WATCH, "5", False),
        (91, LoanClass.SUBSTANDARD, "25", True),
        (180, LoanClass.SUBSTANDARD, "25", True),
        (181, LoanClass.DOUBTFUL, "50", True),
        (360, LoanClass.DOUBTFUL, "50", True),
        (361, LoanClass.LOSS, "100", True),
        (9999, LoanClass.LOSS, "100", True),
    ],
)
def test_classification_boundaries(days: int, label: LoanClass, provision: str, npl: bool) -> None:
    result = classify(days)
    assert result.label == label
    assert result.provision_pct == Decimal(provision)
    assert result.is_npl is npl


def test_invalid_inputs_raise() -> None:
    with pytest.raises(ValueError, match="days_past_due"):
        classify(-1)
    with pytest.raises(ValueError, match="months"):
        installment_amount(Decimal("1000"), Decimal("12"), 0)
    with pytest.raises(ValueError, match="principal"):
        installment_amount(Decimal("0"), Decimal("12"), 12)
    with pytest.raises(ValueError, match="rate"):
        installment_amount(Decimal("1000"), Decimal("-1"), 12)


def test_full_transition_matrix() -> None:
    stages = list(ApplicationStage)
    for current in stages:
        for target in stages:
            if target in allowed_transitions(current):
                assert transition(current, target) == target
            else:
                with pytest.raises(InvalidTransitionError):
                    transition(current, target)


def test_terminal_stages_have_no_exits() -> None:
    assert allowed_transitions(ApplicationStage.REJECTED) == frozenset()
    assert allowed_transitions(ApplicationStage.DISBURSED) == frozenset()


# ---------------------------------------------------------------------------
# P10: loan status machine
# ---------------------------------------------------------------------------


def test_loan_status_full_matrix() -> None:
    allowed = {
        (LoanStatus.ACTIVE, LoanStatus.CLOSED),
        (LoanStatus.ACTIVE, LoanStatus.WRITTEN_OFF),
    }
    for current in LoanStatus:
        for target in LoanStatus:
            if (current, target) in allowed:
                assert loan_transition(current, target) == target
            else:
                with pytest.raises(InvalidTransitionError):
                    loan_transition(current, target)


# ---------------------------------------------------------------------------
# P10: repayment allocation (penalties -> interest -> principal)
# ---------------------------------------------------------------------------

amounts = st.decimals(
    min_value=Decimal("0.01"),
    max_value=Decimal("100000"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)
buckets = st.decimals(
    min_value=Decimal("0"),
    max_value=Decimal("100000"),
    places=2,
    allow_nan=False,
    allow_infinity=False,
)


@given(amount=amounts, penalties=buckets, interest=buckets, principal=buckets)
def test_allocation_invariants(
    amount: Decimal, penalties: Decimal, interest: Decimal, principal: Decimal
) -> None:
    payoff = penalties + interest + principal
    if amount > payoff:
        with pytest.raises(ValueError, match="payoff"):
            allocate_repayment(
                amount,
                penalties_due=penalties,
                interest_due=interest,
                principal_outstanding=principal,
            )
        return
    result = allocate_repayment(
        amount,
        penalties_due=penalties,
        interest_due=interest,
        principal_outstanding=principal,
    )
    # Components always sum to the amount received, to the cent.
    assert result.total == amount
    # Documented order: penalties first, then interest, then principal.
    assert result.penalties == min(amount, penalties)
    assert result.interest == min(amount - result.penalties, interest)
    assert result.principal == amount - result.penalties - result.interest
    assert result.principal <= principal


def test_allocation_order_is_penalties_interest_principal() -> None:
    result = allocate_repayment(
        Decimal("1000.00"),
        penalties_due=Decimal("150.00"),
        interest_due=Decimal("240.00"),
        principal_outstanding=Decimal("24000.00"),
    )
    assert result.penalties == Decimal("150.00")
    assert result.interest == Decimal("240.00")
    assert result.principal == Decimal("610.00")


def test_allocation_partial_payment_stops_at_penalties() -> None:
    result = allocate_repayment(
        Decimal("100.00"),
        penalties_due=Decimal("150.00"),
        interest_due=Decimal("240.00"),
        principal_outstanding=Decimal("24000.00"),
    )
    assert result.penalties == Decimal("100.00")
    assert result.interest == Decimal("0.00")
    assert result.principal == Decimal("0.00")


def test_allocation_rejects_invalid_inputs() -> None:
    with pytest.raises(ValueError, match="positive"):
        allocate_repayment(
            Decimal("0"),
            penalties_due=Decimal("0"),
            interest_due=Decimal("0"),
            principal_outstanding=Decimal("100"),
        )
    with pytest.raises(ValueError, match="negative"):
        allocate_repayment(
            Decimal("10"),
            penalties_due=Decimal("-1"),
            interest_due=Decimal("0"),
            principal_outstanding=Decimal("100"),
        )
    with pytest.raises(ValueError, match="payoff"):
        allocate_repayment(
            Decimal("101"),
            penalties_due=Decimal("0"),
            interest_due=Decimal("0"),
            principal_outstanding=Decimal("100"),
        )


# ---------------------------------------------------------------------------
# P10: early settlement quote
# ---------------------------------------------------------------------------


def test_settlement_quote_totals_the_three_buckets() -> None:
    quote = settlement_quote(Decimal("1000.00"), Decimal("10.00"), Decimal("5.00"))
    assert quote.total == Decimal("1015.00")
    assert quote.principal_balance == Decimal("1000.00")
    assert quote.interest_due == Decimal("10.00")
    assert quote.penalties_due == Decimal("5.00")


def test_settlement_quote_rejects_negative_buckets() -> None:
    with pytest.raises(ValueError, match="negative"):
        settlement_quote(Decimal("-1"), Decimal("0"), Decimal("0"))
