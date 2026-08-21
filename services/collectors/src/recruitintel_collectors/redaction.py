import re
from collections.abc import Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit, urlunsplit

REDACTED = "[REDACTED]"
REDACTED_EMAIL = "[REDACTED_EMAIL]"

_SENSITIVE_KEY = re.compile(
    r"^(?:authorization|proxy-authorization|cookie|set-cookie|access_?token|"
    r"refresh_?token|id_?token|session_?token|oauth_?code|client_?secret|password|"
    r"secret|private_?key|encrypted_?refresh_?token|code_?verifier|resume_?text|dom|"
    r"dom_?html|form_?values|raw_?payload)$",
    re.IGNORECASE,
)
_URL_KEY = re.compile(r"(?:url|uri|href)$", re.IGNORECASE)
_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_AUTHORIZATION_HEADER = re.compile(
    r"\b(authorization|proxy-authorization)\s*:\s*(?:(?:bearer|basic)\s+)?[^\s,;]+",
    re.IGNORECASE,
)
_COOKIE_HEADER = re.compile(r"\b(cookie|set-cookie)\s*:\s*[^\r\n]+", re.IGNORECASE)
_NAMED_SECRET = re.compile(
    r"\b(access_?token|refresh_?token|id_?token|session_?token|oauth_?code|"
    r"client_?secret|code_?verifier|password)\s*[=:]\s*(?:\"[^\"]*\"|'[^']*'|[^\s&,;]+)",
    re.IGNORECASE,
)
_HTTP_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)


def _strip_url_query(value: str) -> str:
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return value.split("?", 1)[0].split("#", 1)[0]
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        return value.split("?", 1)[0].split("#", 1)[0]


def redact_text(value: str) -> str:
    value = _AUTHORIZATION_HEADER.sub(lambda match: f"{match.group(1)}: {REDACTED}", value)
    value = _COOKIE_HEADER.sub(lambda match: f"{match.group(1)}: {REDACTED}", value)
    value = _NAMED_SECRET.sub(lambda match: f"{match.group(1)}={REDACTED}", value)
    value = _HTTP_URL.sub(lambda match: _strip_url_query(match.group(0).rstrip("),.;")), value)
    return _EMAIL.sub(REDACTED_EMAIL, value)


def redact_value(value: Any, *, key: str | None = None) -> Any:
    if key is not None and _SENSITIVE_KEY.match(key):
        return REDACTED
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return redact_text(_strip_url_query(value) if key and _URL_KEY.search(key) else value)
    if isinstance(value, BaseException):
        return {"name": type(value).__name__, "message": redact_text(str(value))}
    if isinstance(value, Mapping):
        return {
            str(item_key): redact_value(item, key=str(item_key)) for item_key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [redact_value(item) for item in value]
    return redact_text(str(value))
