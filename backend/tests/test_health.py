from fastapi.testclient import TestClient


def test_healthz(client: TestClient) -> None:
    res = client.get("/healthz")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_correlation_id_header_is_echoed(client: TestClient) -> None:
    res = client.get("/healthz", headers={"x-request-id": "abc123"})
    assert res.headers["x-request-id"] == "abc123"


def test_correlation_id_is_generated_when_absent(client: TestClient) -> None:
    res = client.get("/healthz")
    assert len(res.headers["x-request-id"]) == 32
