import asyncio
import uuid

from genesis.infrastructure.rate_limit import check_rate_limit


def test_local_rate_limiter_blocks_after_limit() -> None:
    key = f"unit:{uuid.uuid4().hex}"

    async def run() -> list[bool]:
        return [await check_rate_limit(key, 3) for _ in range(5)]

    results = asyncio.run(run())
    assert results == [True, True, True, False, False]


def test_limits_are_per_key() -> None:
    async def run() -> tuple[bool, bool]:
        first = await check_rate_limit(f"unit:{uuid.uuid4().hex}", 1)
        second = await check_rate_limit(f"unit:{uuid.uuid4().hex}", 1)
        return first, second

    assert asyncio.run(run()) == (True, True)
