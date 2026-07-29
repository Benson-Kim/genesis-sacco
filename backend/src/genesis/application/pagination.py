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
