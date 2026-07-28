"""Unit tests for genesis.domain.members - pure, no I/O (P8)."""

import pytest

from genesis.domain.members import (
    InvalidStatusTransitionError,
    MemberStatus,
    format_member_no,
    transition,
)

_ALLOWED = {
    (MemberStatus.ACTIVE, MemberStatus.ARREARS),
    (MemberStatus.ARREARS, MemberStatus.ACTIVE),
    (MemberStatus.ACTIVE, MemberStatus.EXITED),
    (MemberStatus.ARREARS, MemberStatus.EXITED),
}


@pytest.mark.parametrize("current", list(MemberStatus))
@pytest.mark.parametrize("target", list(MemberStatus))
def test_full_transition_matrix(current: MemberStatus, target: MemberStatus) -> None:
    """Every pair is either explicitly allowed or raises (gate 1.4)."""
    if (current, target) in _ALLOWED:
        assert transition(current, target) is target
    else:
        with pytest.raises(InvalidStatusTransitionError):
            transition(current, target)


def test_exited_is_terminal() -> None:
    for target in MemberStatus:
        with pytest.raises(InvalidStatusTransitionError):
            transition(MemberStatus.EXITED, target)


def test_member_no_formatting() -> None:
    assert format_member_no(1) == "GP-0001"
    assert format_member_no(42) == "GP-0042"
    assert format_member_no(9999) == "GP-9999"
    assert format_member_no(10000) == "GP-10000"


def test_member_no_rejects_non_positive() -> None:
    with pytest.raises(ValueError, match="positive"):
        format_member_no(0)
    with pytest.raises(ValueError, match="positive"):
        format_member_no(-3)
