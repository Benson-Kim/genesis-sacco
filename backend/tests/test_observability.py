import json
import logging

from genesis.logging import JsonFormatter, correlation_id_var, scrub


def test_scrub_redacts_pii() -> None:
    text = "contact jane.doe@example.com or +254 712 345 678 now"
    out = scrub(text)
    assert "example.com" not in out
    assert "712" not in out
    assert "[redacted]" in out


def test_json_formatter_includes_correlation_id_and_scrubs() -> None:
    token = correlation_id_var.set("cid-123")
    try:
        record = logging.LogRecord(
            "t", logging.INFO, __file__, 1, "hello test@example.com", None, None
        )
        payload = json.loads(JsonFormatter().format(record))
    finally:
        correlation_id_var.reset(token)
    assert payload["correlation_id"] == "cid-123"
    assert "test@example.com" not in payload["message"]
