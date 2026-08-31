import json
import logging
from datetime import UTC, datetime
from typing import Any

from .redaction import redact_text, redact_value

_STANDARD_FIELDS = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_text(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_FIELDS and not key.startswith("_"):
                payload[key] = redact_value(value, key=key)
        if record.exc_info:
            payload["exception"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, default=str, separators=(",", ":"))


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
