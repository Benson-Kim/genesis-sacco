"""Shared request-parameter guards for API routers (gates 1.4, 1.6).

Single source of truth (DRY) for checks that several routers repeat:
the cash-channel restriction on money-moving endpoints and the
no-future-dates rule for as_of style parameters.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

from genesis.domain.ledger import Channel
from genesis.errors import InvalidInputError

#: Channels on which money physically moves. Accrual/internal postings
#: are made by jobs through their dedicated services, never by routes.
CASH_CHANNELS = frozenset({Channel.MPESA, Channel.BANK})


def require_cash_channel(channel: Channel) -> Channel:
    if channel not in CASH_CHANNELS:
        raise InvalidInputError(f"channel must be one of: mpesa, bank; got '{channel.value}'")
    return channel


def resolve_as_of(as_of: date | None) -> date:
    """Default to today and reject future dates (gate 1.6).

    A future as_of would let a caller inflate days-past-due, fabricate
    interest that is not yet due, or accrue a period that has not ended.
    Backdating stays allowed for reconciliation and idempotent re-runs.
    """
    today = datetime.now(UTC).date()
    if as_of is None:
        return today
    if as_of > today:
        raise InvalidInputError("as_of must not be in the future")
    return as_of
