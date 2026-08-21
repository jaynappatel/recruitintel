import json
import logging
from io import StringIO
from pathlib import Path

from recruitintel_collectors.logging import JsonFormatter
from recruitintel_collectors.redaction import redact_text, redact_value

FIXTURE_PATH = Path(__file__).parents[3] / "test-fixtures" / "redaction" / "golden.json"


def test_redaction_matches_shared_golden_fixture() -> None:
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    for case in fixture["textCases"]:
        result = redact_text(case["input"])
        assert result == case["expected"]
        assert not any(forbidden in result for forbidden in case["forbidden"])

    result = redact_value(fixture["objectCase"]["input"])
    assert result == fixture["objectCase"]["expected"]
    serialized = json.dumps(result)
    assert not any(forbidden in serialized for forbidden in fixture["objectCase"]["forbidden"])


def test_exception_and_extra_fields_are_redacted() -> None:
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JsonFormatter())
    logger = logging.getLogger("redaction-test")
    logger.handlers = [handler]
    logger.propagate = False

    try:
        raise RuntimeError("access_token=secret owner@example.com")
    except RuntimeError:
        logger.exception(
            "provider failed for owner@example.com",
            extra={"authorization": "Bearer secret", "safe_id": "run-123"},
        )

    payload = json.loads(stream.getvalue())
    serialized = json.dumps(payload)
    assert payload["authorization"] == "[REDACTED]"
    assert payload["safe_id"] == "run-123"
    assert "secret" not in serialized
    assert "owner@example.com" not in serialized
