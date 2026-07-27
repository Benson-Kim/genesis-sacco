"""Redis client helpers and readiness probe."""

import logging

from redis.asyncio import Redis

logger = logging.getLogger("genesis.infrastructure.redis")


async def ping_redis(redis_url: str) -> bool:
    client = Redis.from_url(redis_url)
    try:
        await client.ping()
    except Exception:
        logger.exception("redis ping failed")
        return False
    finally:
        await client.aclose()
    return True
