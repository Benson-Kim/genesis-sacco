"""Redis client helpers and readiness probe."""

import logging

from redis.asyncio import Redis

logger = logging.getLogger("genesis.infrastructure.redis")


async def ping_redis(redis_url: str) -> bool:
    client = Redis.from_url(redis_url)
    try:
        await client.ping()
    except Exception:  # noqa: BLE001 - readiness probe: log the category, never raise (gate 1.2)
        logger.exception("redis ping failed")
        return False
    finally:
        await client.aclose()
    return True
