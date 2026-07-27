from datetime import UTC, datetime, timedelta

from genesis.domain.otp import OTP_MAX_ATTEMPTS, OtpResult, evaluate_challenge, hash_code

NOW = datetime(2026, 7, 27, 12, 0, 0, tzinfo=UTC)
LATER = NOW + timedelta(minutes=5)


def _hash(code: str) -> str:
    return hash_code(code, salt="challenge", pepper="pepper")


def test_correct_code_is_accepted() -> None:
    result = evaluate_challenge(
        stored_hash=_hash("123456"),
        presented_hash=_hash("123456"),
        attempts=0,
        expires_at=LATER,
        consumed_at=None,
        now=NOW,
    )
    assert result is OtpResult.OK


def test_wrong_code_is_mismatch() -> None:
    result = evaluate_challenge(
        stored_hash=_hash("123456"),
        presented_hash=_hash("654321"),
        attempts=0,
        expires_at=LATER,
        consumed_at=None,
        now=NOW,
    )
    assert result is OtpResult.MISMATCH


def test_attempt_limit_locks_even_correct_code() -> None:
    result = evaluate_challenge(
        stored_hash=_hash("123456"),
        presented_hash=_hash("123456"),
        attempts=OTP_MAX_ATTEMPTS,
        expires_at=LATER,
        consumed_at=None,
        now=NOW,
    )
    assert result is OtpResult.LOCKED


def test_expired_challenge_is_rejected() -> None:
    result = evaluate_challenge(
        stored_hash=_hash("123456"),
        presented_hash=_hash("123456"),
        attempts=0,
        expires_at=NOW,
        consumed_at=None,
        now=NOW,
    )
    assert result is OtpResult.EXPIRED


def test_consumed_challenge_is_single_use() -> None:
    result = evaluate_challenge(
        stored_hash=_hash("123456"),
        presented_hash=_hash("123456"),
        attempts=1,
        expires_at=LATER,
        consumed_at=NOW,
        now=NOW,
    )
    assert result is OtpResult.CONSUMED


def test_hash_depends_on_salt_and_pepper() -> None:
    base = hash_code("123456", salt="a", pepper="p")
    assert hash_code("123456", salt="b", pepper="p") != base
    assert hash_code("123456", salt="a", pepper="q") != base
