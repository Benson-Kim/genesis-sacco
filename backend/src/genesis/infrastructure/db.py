"""Database engine/session management and readiness probe."""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

logger = logging.getLogger("genesis.infrastructure.db")

_engines: dict[str, AsyncEngine] = {}


def get_engine(database_url: str) -> AsyncEngine:
    engine = _engines.get(database_url)
    if engine is None:
        engine = create_async_engine(database_url, pool_pre_ping=True)
        _engines[database_url] = engine
    return engine


def get_sessionmaker(database_url: str) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(database_url), expire_on_commit=False)


async def ping_db(database_url: str) -> bool:
    try:
        async with get_engine(database_url).connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception:  # noqa: BLE001 - readiness probe: log the category, never raise (gate 1.2)
        logger.exception("database ping failed")
        return False
    return True
