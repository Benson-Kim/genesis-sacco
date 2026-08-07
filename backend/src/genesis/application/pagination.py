"""Shared keyset cursor helpers for (created_at, id) pagination (gate 1.3).

Single source of truth for cursor encoding (DRY): the loan book and the
applications listing paginate on the same (created_at DESC, id DESC)
keyset and must parse cursors identically.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from genesis.errors import InvalidInputError


def parse_created_id_cursor(cursor: str, *, entity: str) -> tuple[datetime, str]:
    """Parse an opaque '<created_at iso>|<uuid>' keyset cursor.

    Naive timestamps are rejected: cursors are only ever built from
    timestamptz values, so a missing UTC offset means a forged or
    corrupted cursor rather than a valid page position.
    """
    ts_raw, _, id_raw = cursor.partition("|")
    try:
        ts = datetime.fromisoformat(ts_raw)
        row_id = str(uuid.UUID(id_raw))
    except ValueError as exc:
        raise InvalidInputError(f"invalid {entity} cursor") from exc
    if ts.tzinfo is None:
        raise InvalidInputError(f"invalid {entity} cursor")
    return ts, row_id


def build_created_id_cursor(created_at: datetime, row_id: object) -> str:
    """Encode the keyset position of the last row of a page."""
    return f"{created_at.isoformat()}|{row_id}"


def parse_band_register_cursor(cursor: str, *, entity: str) -> tuple[bool, datetime, str]:
    """Parse an opaque '<actionable 0|1>|<created_at iso>|<uuid>' keyset
    cursor for a two-band (actionable-first) register order (the 0038
    pattern). The leading flag is the band of the last row of the
    previous page; a forged flag is rejected exactly like a forged
    timestamp.

    Hoisted verbatim from application/corrections.py (gate 1.1) when
    the share-transfers register (issue #31 ledger (m), MR !83) became
    the pattern's third consumer — the band registers must never
    diverge on cursor encoding.
    """
    flag_raw, _, rest = cursor.partition("|")
    if flag_raw not in {"0", "1"}:
        raise InvalidInputError(f"invalid {entity} cursor")
    c_ts, c_id = parse_created_id_cursor(rest, entity=entity)
    return flag_raw == "1", c_ts, c_id


def build_band_register_cursor(actionable: bool, created_at: datetime, row_id: object) -> str:
    """Encode the two-band keyset position of the last row of a page."""
    return f"{1 if actionable else 0}|{build_created_id_cursor(created_at, row_id)}"
