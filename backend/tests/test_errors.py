from fastapi import FastAPI
from fastapi.testclient import TestClient

from genesis.api.app import create_app
from genesis.errors import ConflictError


def _app_with_routes() -> FastAPI:
    app = create_app()

    @app.get("/conflict")
    def conflict() -> None:
        raise ConflictError("internal detail")

    @app.get("/boom")
    def boom() -> None:
        raise RuntimeError("secret stack detail test@example.com")

    return app


def test_app_error_envelope_is_sanitized() -> None:
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/conflict")
    assert res.status_code == 409
    body = res.json()
    assert body["category"] == "conflict"
    assert body["correlation_id"]
    assert "internal detail" not in res.text


def test_unhandled_error_never_leaks_internals() -> None:
    client = TestClient(_app_with_routes(), raise_server_exceptions=False)
    res = client.get("/boom")
    assert res.status_code == 500
    assert res.json()["category"] == "internal_error"
    assert "secret stack detail" not in res.text
