"""Falsifiable suite for the opaque signed cursor codec (#31 batch 13, N4).

Pure, no I/O. Every leg names the failure mode it guards (MASTER_PROMPT
§4): FM1 round-trip exactness per keyset tuple shape (with a
hand-computed independent oracle), FM2/FM3 payload/tag bit-flips,
FM4 truncated/garbage/non-base64, FM5 cross-endpoint replay, FM6
cross-tenant replay, FM7 wrong key version, FM8 constant-time compare
(falsifiable by swapping ``hmac.compare_digest`` for ``==``).
"""

import base64
import hashlib
import hmac as hmac_module
import os
import struct
import uuid

import pytest

from genesis.application import pagination
from genesis.application.branches import BRANCH_MEMBERS_SCOPE
from genesis.application.members import MEMBERS_LIST_SCOPE
from genesis.application.pagination import decode_cursor, encode_cursor
from genesis.errors import InvalidInputError
from genesis.settings import get_settings

TENANT = uuid.UUID("6dcd4ce0-6dcd-4ce0-8dcd-4ce06dcd4ce0")
OTHER_TENANT = uuid.UUID("1b2f8a44-1b2f-4a44-8b2f-8a441b2f8a44")
ENDPOINT = MEMBERS_LIST_SCOPE  # the real exported scope symbol (B13-R2)

#: Every distinct plaintext keyset tuple shape served on the wire
#: (the batch-13 inventory): raw member_no (the N1 (length, member_no)
#: numeric tuple), raw doc_type string, ISO date (periods),
#: timestamp|uuid composite, bigint audit composite, days-past-due
#: int|uuid worklist composite, and the 0038 two-band register shape.
SHAPES = (
    "GP-0042",
    "GP-10000",
    "kra_pin",
    "2026-01-31",
    "2026-07-29T12:00:00+00:00|8c5f3ab0-90fb-4b21-9d70-4a4b6a4f3a10",
    "2026-07-29T12:00:00+00:00|1048576",
    "184|8c5f3ab0-90fb-4b21-9d70-4a4b6a4f3a10",
    "1|2026-07-29T12:00:00+00:00|8c5f3ab0-90fb-4b21-9d70-4a4b6a4f3a10",
)


def _raw(token: str) -> bytes:
    return base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))


def _tok(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.mark.parametrize("inner", SHAPES)
def test_round_trip_exactness_per_shape(inner: str) -> None:
    """FM1: decode(encode(x)) == x, byte-exact, for EVERY tuple shape."""
    token = encode_cursor(inner, tenant_id=TENANT, endpoint=ENDPOINT)
    assert token != inner  # actually opaque, not a pass-through
    out = decode_cursor(token, tenant_id=TENANT, endpoint=ENDPOINT, entity="member")
    assert out == inner


def test_hand_computed_oracle_pins_the_token_format() -> None:
    """FM1 oracle: the token is derived here INDEPENDENTLY from the
    documented spec — base64url(V || payload || HMAC-SHA256(key,
    V || len(scope)_4BE || scope || payload)) with scope
    '<tenant>|<endpoint>' — using only stdlib primitives, never the
    codec's own helpers. Falsifiable by ANY drift in the token layout
    (field order, separator, scope shape, digest, encoding).
    """
    key = os.environ["CURSOR_SIGNING_KEY"].encode()
    version = get_settings().cursor_key_version
    payload = b"GP-0042"
    scope = f"{TENANT}|{ENDPOINT}".encode()
    tag = hmac_module.new(
        key, bytes([version]) + struct.pack(">I", len(scope)) + scope + payload, hashlib.sha256
    ).digest()
    expected = base64.urlsafe_b64encode(bytes([version]) + payload + tag).rstrip(b"=").decode()
    assert encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT) == expected


def test_payload_bit_flip_rejected() -> None:
    """FM2: one flipped bit in the payload region breaks the tag."""
    raw = bytearray(_raw(encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)))
    raw[3] ^= 0x01  # inside payload (byte 0 is the version byte)
    with pytest.raises(InvalidInputError, match="invalid member cursor"):
        decode_cursor(_tok(bytes(raw)), tenant_id=TENANT, endpoint=ENDPOINT, entity="member")


def test_tag_bit_flip_rejected() -> None:
    """FM3: one flipped bit in the tag region fails verification."""
    raw = bytearray(_raw(encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)))
    raw[-1] ^= 0x01
    with pytest.raises(InvalidInputError, match="invalid member cursor"):
        decode_cursor(_tok(bytes(raw)), tenant_id=TENANT, endpoint=ENDPOINT, entity="member")


@pytest.mark.parametrize(
    "bad",
    [
        "",  # empty
        "zz",  # shorter than version+tag
        "not base64 !!!",  # non-alphabet bytes (strict decode)
        "GP-0042",  # a raw plaintext cursor is no longer accepted
        "2026-07-29T12:00:00+00:00|8c5f3ab0-90fb-4b21-9d70-4a4b6a4f3a10",
    ],
)
def test_truncated_and_garbage_tokens_rejected(bad: str) -> None:
    """FM4: malformed tokens are sanitized 400s — never 500s."""
    with pytest.raises(InvalidInputError, match="invalid member cursor"):
        decode_cursor(bad, tenant_id=TENANT, endpoint=ENDPOINT, entity="member")


def test_truncated_valid_token_rejected() -> None:
    """FM4: truncating a VALID token (losing tag bytes) is rejected."""
    token = encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)
    half = token[: len(token) // 2]
    with pytest.raises(InvalidInputError, match="invalid member cursor"):
        decode_cursor(half, tenant_id=TENANT, endpoint=ENDPOINT, entity="member")


def test_cross_endpoint_replay_rejected() -> None:
    """FM5: a token minted for one endpoint never opens another."""
    token = encode_cursor("GP-0042", tenant_id=TENANT, endpoint=MEMBERS_LIST_SCOPE)
    with pytest.raises(InvalidInputError, match="invalid roster cursor"):
        decode_cursor(token, tenant_id=TENANT, endpoint=BRANCH_MEMBERS_SCOPE, entity="roster")


def test_cross_tenant_replay_rejected() -> None:
    """FM6: a token minted for one tenant never opens another's page."""
    token = encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)
    with pytest.raises(InvalidInputError, match="invalid member cursor"):
        decode_cursor(token, tenant_id=OTHER_TENANT, endpoint=ENDPOINT, entity="member")


def test_wrong_key_version_rejected() -> None:
    """FM7: a token carrying a different key-version byte fails closed
    BEFORE tag verification (rotation semantics)."""
    raw = bytearray(_raw(encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)))
    assert raw[0] == get_settings().cursor_key_version
    raw[0] ^= 0xFF
    with pytest.raises(InvalidInputError, match="invalid member cursor"):
        decode_cursor(_tok(bytes(raw)), tenant_id=TENANT, endpoint=ENDPOINT, entity="member")


def test_tag_check_is_constant_time(monkeypatch: pytest.MonkeyPatch) -> None:
    """FM8: the primitive verifies via hmac.compare_digest — falsifiable
    by swapping the comparison to ``==`` (the spy then never fires)."""
    calls: list[int] = []
    real = hmac_module.compare_digest

    def spy(a: object, b: object) -> bool:
        calls.append(1)
        return real(a, b)  # type: ignore[arg-type]

    monkeypatch.setattr(pagination.hmac, "compare_digest", spy)
    token = encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)
    assert decode_cursor(token, tenant_id=TENANT, endpoint=ENDPOINT, entity="member") == "GP-0042"
    assert calls, "decode did not route the tag check through hmac.compare_digest"


def test_unconfigured_key_is_a_server_error_not_a_400(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An unset signing key is a DEPLOYMENT error (sanitized 500 path),
    never a 400 that blames the caller (the jwt_signing_key pattern)."""
    unconfigured = get_settings().model_copy(update={"cursor_signing_key": ""})
    monkeypatch.setattr(pagination, "get_settings", lambda: unconfigured)
    with pytest.raises(RuntimeError, match="cursor signing key not configured"):
        encode_cursor("GP-0042", tenant_id=TENANT, endpoint=ENDPOINT)
