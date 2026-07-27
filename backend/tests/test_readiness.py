import asyncio
import os

import pytest
from fastapi.testclient import TestClient

from genesis.api import health
from genesis.infrastructure.db import ping_db
from genesis.infrastructure.redis_client import ping_redis
from genesis.settings import Settings


def test_readyz_unconfigured_database_returns_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(health, "get_settings", lambda: Settings(database_url="", redis_url=""))
    res = client.get("/readyz")
    assert res.status_code == 503
    assert res.json()["database"] == "unconfigured"
    assert res.json()["status"] == "unready"


@pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="requires a database service")
def test_readyz_with_database(client: TestClient) -> None:
    res = client.get("/readyz")
    assert res.status_code == 200
    assert res.json()["database"] == "ok"


def test_ping_db_failure_is_reported_not_raised() -> None:
    assert asyncio.run(ping_db("postgresql+psycopg://ghost@127.0.0.1:9/void")) is False


def test_ping_redis_failure_is_reported_not_raised() -> None:
    assert asyncio.run(ping_redis("redis://127.0.0.1:9/0")) is False
