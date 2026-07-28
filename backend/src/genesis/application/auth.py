"""Authentication use-cases: OTP step-up and JWT lifecycle (gates 1.4, 1.6).

Access tokens live at most 15 minutes. Refresh tokens are hashed at rest,
rotate on every use, and belong to a family: any reuse of a spent token
revokes the whole family. OTP delivery goes through the transactional
outbox stub (gate 1.2). All verification runs under row locks (gate 1.4).
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from genesis.application.outbox import enqueue_event
from genesis.domain.otp import (
    OTP_LENGTH,
    OTP_TTL_SECONDS,
    OtpResult,
    evaluate_challenge,
    hash_code,
)
from genesis.errors import UnauthenticatedError
from genesis.settings import get_settings

ACCESS_TOKEN_TTL_SECONDS = 900
REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 3600
_JWT_ALGORITHM = "HS256"


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int


@dataclass(frozen=True)
class AuthFailure:
    """Failed authentication outcome whose side effects must survive.

    Punitive state changes (OTP attempt counters, refresh-family
    revocation) have to be committed even though the request fails, so
    failures are returned as values and translated into a 401 by the API
    layer only after the transaction has committed (gates 1.4, 1.6).
    Raising inside the transaction would roll the punitive state back.
    """

    reason: str


@dataclass(frozen=True)
class AuthContext:
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    role_id: uuid.UUID


def _now() -> datetime:
    return datetime.now(UTC)


def _signing_key() -> str:
    key = get_settings().jwt_signing_key
    if not key:
        raise UnauthenticatedError("jwt signing key not configured")
    return key


def _otp_pepper() -> str:
    pepper = get_settings().otp_pepper
    if not pepper:
        raise UnauthenticatedError("otp pepper not configured")
    return pepper


def _hash_refresh_token(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def issue_access_token(ctx: AuthContext, *, now: datetime | None = None) -> str:
    """Signed access token with a lifetime of at most 15 minutes (gate 1.6)."""
    issued_at = now or _now()
    claims: dict[str, Any] = {
        "sub": str(ctx.user_id),
        "tid": str(ctx.tenant_id),
        "rid": str(ctx.role_id),
        "iat": int(issued_at.timestamp()),
        "exp": int(issued_at.timestamp()) + ACCESS_TOKEN_TTL_SECONDS,
    }
    return jwt.encode(claims, _signing_key(), algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str) -> AuthContext:
    """Validate a bearer token; failures surface a sanitized 401."""
    try:
        claims = jwt.decode(token, _signing_key(), algorithms=[_JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise UnauthenticatedError("invalid access token") from exc
    return AuthContext(
        user_id=uuid.UUID(str(claims["sub"])),
        tenant_id=uuid.UUID(str(claims["tid"])),
        role_id=uuid.UUID(str(claims["rid"])),
    )


async def request_otp(session: AsyncSession, tenant_id: uuid.UUID, email: str) -> None:
    """Issue a single-use, 5-minute OTP; never reveals whether the user exists."""
    row = (
        await session.execute(
            text("SELECT id FROM users WHERE email = :email AND status = 'active'"),
            {"email": email},
        )
    ).first()
    if row is None:
        return
    user_id = str(row[0])
    challenge_id = uuid.uuid4()
    code = f"{secrets.randbelow(10**OTP_LENGTH):0{OTP_LENGTH}d}"
    await session.execute(
        text(
            "INSERT INTO otp_challenges (id, tenant_id, user_id, code_hash, expires_at) "
            "VALUES (CAST(:id AS uuid), CAST(:tid AS uuid), CAST(:uid AS uuid), :ch, :exp)"
        ),
        {
            "id": str(challenge_id),
            "tid": str(tenant_id),
            "uid": user_id,
            "ch": hash_code(code, salt=str(challenge_id), pepper=_otp_pepper()),
            "exp": _now() + timedelta(seconds=OTP_TTL_SECONDS),
        },
    )
    await enqueue_event(
        session,
        tenant_id,
        event_type="auth.otp_requested",
        payload={"user_id": user_id, "challenge_id": str(challenge_id), "code": code},
    )


async def verify_otp(
    session: AsyncSession, tenant_id: uuid.UUID, email: str, code: str
) -> TokenPair | AuthFailure:
    """Verify the newest challenge under a row lock (gate 1.4).

    Failures are returned (not raised) so the attempt-counter increment
    commits with the surrounding transaction; the API layer raises the
    401 after commit.
    """
    row = (
        await session.execute(
            text(
                "SELECT c.id, c.code_hash, c.attempts, c.expires_at, c.consumed_at, "
                "u.id AS user_id, u.role_id "
                "FROM otp_challenges c JOIN users u ON u.id = c.user_id "
                "WHERE u.email = :email "
                "ORDER BY c.created_at DESC LIMIT 1 FOR UPDATE OF c"
            ),
            {"email": email},
        )
    ).first()
    if row is None:
        return AuthFailure("no otp challenge")
    challenge_id, stored_hash, attempts, expires_at, consumed_at, user_id, role_id = row
    presented = hash_code(code, salt=str(challenge_id), pepper=_otp_pepper())
    result = evaluate_challenge(
        stored_hash=str(stored_hash),
        presented_hash=presented,
        attempts=int(attempts),
        expires_at=expires_at,
        consumed_at=consumed_at,
        now=_now(),
    )
    if result is OtpResult.MISMATCH:
        await session.execute(
            text("UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = CAST(:id AS uuid)"),
            {"id": str(challenge_id)},
        )
    if result is not OtpResult.OK:
        # Returned, not raised: the increment above must commit so the
        # lockout engages after OTP_MAX_ATTEMPTS failures (gate 1.6).
        return AuthFailure(f"otp {result.value}")
    await session.execute(
        text("UPDATE otp_challenges SET consumed_at = :now WHERE id = CAST(:id AS uuid)"),
        {"now": _now(), "id": str(challenge_id)},
    )
    ctx = AuthContext(
        user_id=uuid.UUID(str(user_id)),
        tenant_id=tenant_id,
        role_id=uuid.UUID(str(role_id)),
    )
    return await _issue_token_pair(session, ctx, family_id=uuid.uuid4())


async def rotate_refresh_token(
    session: AsyncSession, tenant_id: uuid.UUID, refresh_token: str
) -> TokenPair | AuthFailure:
    """Rotate under a row lock; reuse of a spent token revokes its family.

    Failures are returned (not raised) so the family-wide revocation
    commits with the surrounding transaction; the API layer raises the
    401 after commit.
    """
    row = (
        await session.execute(
            text(
                "SELECT id, user_id, family_id, status, expires_at "
                "FROM refresh_tokens WHERE token_hash = :th FOR UPDATE"
            ),
            {"th": _hash_refresh_token(refresh_token)},
        )
    ).first()
    if row is None:
        return AuthFailure("unknown refresh token")
    token_id, user_id, family_id, status, expires_at = row
    if status != "active":
        # Returned, not raised: the revocation must commit so every
        # descendant token in the family dies with the reuse (gate 1.6).
        await _revoke_family(session, family_id)
        return AuthFailure("refresh token reuse detected")
    if _now() >= expires_at:
        await _revoke_family(session, family_id)
        return AuthFailure("refresh token expired")
    role_id = (
        await session.execute(
            text("SELECT role_id FROM users WHERE id = CAST(:uid AS uuid)"),
            {"uid": str(user_id)},
        )
    ).scalar_one()
    await session.execute(
        text(
            "UPDATE refresh_tokens SET status = 'rotated', rotated_at = :now "
            "WHERE id = CAST(:id AS uuid)"
        ),
        {"now": _now(), "id": str(token_id)},
    )
    ctx = AuthContext(
        user_id=uuid.UUID(str(user_id)),
        tenant_id=tenant_id,
        role_id=uuid.UUID(str(role_id)),
    )
    return await _issue_token_pair(session, ctx, family_id=uuid.UUID(str(family_id)))


async def revoke_refresh_token(session: AsyncSession, refresh_token: str) -> None:
    """Logout: revoke the whole family behind the presented token."""
    row = (
        await session.execute(
            text("SELECT family_id FROM refresh_tokens WHERE token_hash = :th"),
            {"th": _hash_refresh_token(refresh_token)},
        )
    ).first()
    if row is None:
        return
    await _revoke_family(session, row[0])


async def _issue_token_pair(
    session: AsyncSession, ctx: AuthContext, *, family_id: uuid.UUID
) -> TokenPair:
    refresh_token = secrets.token_urlsafe(48)
    await session.execute(
        text(
            "INSERT INTO refresh_tokens "
            "(tenant_id, user_id, family_id, token_hash, expires_at) VALUES "
            "(CAST(:tid AS uuid), CAST(:uid AS uuid), CAST(:fid AS uuid), :th, :exp)"
        ),
        {
            "tid": str(ctx.tenant_id),
            "uid": str(ctx.user_id),
            "fid": str(family_id),
            "th": _hash_refresh_token(refresh_token),
            "exp": _now() + timedelta(seconds=REFRESH_TOKEN_TTL_SECONDS),
        },
    )
    return TokenPair(
        access_token=issue_access_token(ctx),
        refresh_token=refresh_token,
        expires_in=ACCESS_TOKEN_TTL_SECONDS,
    )


async def _revoke_family(session: AsyncSession, family_id: object) -> None:
    await session.execute(
        text(
            "UPDATE refresh_tokens SET status = 'revoked' "
            "WHERE family_id = CAST(:fid AS uuid) AND status <> 'revoked'"
        ),
        {"fid": str(family_id)},
    )
