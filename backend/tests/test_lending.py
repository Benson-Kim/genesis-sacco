from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from genesis.domain.lending import (
    ApplicationStage,
    InvalidTransitionError,
    LoanClass,
    allowed_transitions,
    build_schedule,
    classify,
    installment_amount,
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
