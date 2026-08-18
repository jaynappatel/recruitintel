import json
from typing import Any

from .base import ParsedRow
from .common import normalize_header


def _record_list(document: Any) -> list[Any]:
    if isinstance(document, list):
        return document
    if isinstance(document, dict):
        for key in ("records", "items", "data", "questions", "jobs"):
            candidate = document.get(key)
            if isinstance(candidate, list):
                return candidate
        return [document]
    raise ValueError("JSON recruiting files must contain an object or array")


class JSONParser:
    def parse(self, content: str) -> tuple[ParsedRow, ...]:
        document = json.loads(content)
        rows: list[ParsedRow] = []
        for row_number, record in enumerate(_record_list(document), start=1):
            if not isinstance(record, dict):
                continue
            values = {
                normalize_header(str(key)): _string_value(value)
                for key, value in record.items()
                if normalize_header(str(key))
            }
            rows.append(ParsedRow(values=values, row_number=row_number))
        return tuple(rows)


def _string_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))
    return str(value)
