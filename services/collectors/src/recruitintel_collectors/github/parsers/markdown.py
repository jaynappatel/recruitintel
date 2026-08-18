import re

from .base import ParsedRow
from .common import normalize_header

_SEPARATOR_CELL = re.compile(r"^:?-{3,}:?$")


def _split_row(line: str) -> list[str]:
    candidate = line.strip()
    if candidate.startswith("|"):
        candidate = candidate[1:]
    if candidate.endswith("|") and not candidate.endswith(r"\|"):
        candidate = candidate[:-1]

    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for character in candidate:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == "|":
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(character)
    current.append("\\" if escaped else "")
    cells.append("".join(current).strip())
    return cells


class MarkdownTableParser:
    """Parse all GitHub-flavored Markdown tables without rendering HTML."""

    def parse(self, content: str) -> tuple[ParsedRow, ...]:
        lines = content.splitlines()
        output: list[ParsedRow] = []
        index = 0
        while index + 1 < len(lines):
            header_cells = _split_row(lines[index])
            separator_cells = _split_row(lines[index + 1])
            is_table = (
                len(header_cells) >= 2
                and len(header_cells) == len(separator_cells)
                and all(_SEPARATOR_CELL.fullmatch(cell.strip()) for cell in separator_cells)
            )
            if not is_table:
                index += 1
                continue

            headers = [normalize_header(cell) for cell in header_cells]
            index += 2
            while index < len(lines) and "|" in lines[index]:
                values = _split_row(lines[index])
                if len(values) < len(headers):
                    values.extend([""] * (len(headers) - len(values)))
                if len(values) > len(headers):
                    values = values[: len(headers)]
                row = {
                    header: value for header, value in zip(headers, values, strict=True) if header
                }
                if any(value.strip() for value in row.values()):
                    output.append(ParsedRow(values=row, row_number=index + 1))
                index += 1
        return tuple(output)
