import os

import pytest
from fastapi.testclient import TestClient

from genesis.api.app import create_app


@pytest.fixture(autouse=True, scope="session")
def _auth_env() -> None:
    """Test-only key material; real values come from CI/CD variables (gate 1.6)."""
    os.environ.setdefault("JWT_SIGNING_KEY", "test-only-signing-key")
    os.environ.setdefault("OTP_PEPPER", "test-only-pepper")
    # >= 32 bytes: the B13-R5 boot guard rejects shorter key material.
    os.environ.setdefault("CURSOR_SIGNING_KEY", "test-only-cursor-signing-key-0123456789")


@pytest.fixture()
def client() -> TestClient:
    return TestClient(create_app(), raise_server_exceptions=False)
