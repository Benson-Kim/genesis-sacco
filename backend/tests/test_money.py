from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from genesis.domain.money import CENT, ZERO, monthly_rate, to_cents

amounts = st.decimals(
    min_value=Decimal("-10000000"),
    max_value=Decimal("10000000"),
    allow_nan=False,
    allow_infinity=False,
)


def test_rounds_half_up() -> None:
    assert to_cents(Decimal("1.005")) == Decimal("1.01")
    assert to_cents(Decimal("1.004")) == Decimal("1.00")
    assert to_cents(Decimal("2.675")) == Decimal("2.68")
    assert to_cents(Decimal("-1.005")) == Decimal("-1.01")


def test_constants() -> None:
    assert Decimal("0.01") == CENT
    assert Decimal("0.00") == ZERO


@given(value=amounts)
def test_to_cents_is_idempotent_and_two_places(value: Decimal) -> None:
    once = to_cents(value)
    assert to_cents(once) == once
    assert once == once.quantize(CENT)


def test_monthly_rate() -> None:
    assert monthly_rate(Decimal("12")) == Decimal("0.01")
    assert monthly_rate(Decimal("0")) == Decimal("0")
    assert monthly_rate(Decimal("18")) == Decimal("0.015")
