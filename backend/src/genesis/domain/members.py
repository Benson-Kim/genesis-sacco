"""Members domain: types, status machine, numbering format (P8).

Zero I/O. Status transitions mirror the prototype: Active<->Arrears and
Active/Arrears->Exited; Exited is terminal. Illegal transitions raise
(gate 1.4). Member numbers use the GP-XXXX format; the race-safe
allocation lives in the application layer.
"""

from __future__ import annotations

import enum

MEMBER_NO_PREFIX = "GP-"


class MemberType(enum.StrEnum):
    PERSON = "person"
    COMPANY = "company"
    GROUP = "group"
    VEHICLE = "vehicle"


class MemberStatus(enum.StrEnum):
    ACTIVE = "active"
    ARREARS = "arrears"
    EXITED = "exited"


class InvalidStatusTransitionError(Exception):
    """Raised when a member status transition is not allowed (gate 1.4)."""


_ALLOWED: dict[MemberStatus, frozenset[MemberStatus]] = {
    MemberStatus.ACTIVE: frozenset({MemberStatus.ARREARS, MemberStatus.EXITED}),
    MemberStatus.ARREARS: frozenset({MemberStatus.ACTIVE, MemberStatus.EXITED}),
    MemberStatus.EXITED: frozenset(),
}


def transition(current: MemberStatus, target: MemberStatus) -> MemberStatus:
    """Validate a status transition; raise on any illegal move (gate 1.4)."""
    if target not in _ALLOWED[current]:
        raise InvalidStatusTransitionError(f"cannot move member from {current} to {target}")
    return target


def format_member_no(seq: int) -> str:
    """GP-XXXX member number; grows past four digits without collision."""
    if seq <= 0:
        raise ValueError("member number sequence must be positive")
    return f"{MEMBER_NO_PREFIX}{seq:04d}"
