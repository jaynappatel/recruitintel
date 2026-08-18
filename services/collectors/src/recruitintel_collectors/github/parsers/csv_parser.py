import csv
import io

from .base import ParsedRow
from .common import normalize_header


class CSVParser:
    def parse(self, content: str) -> tuple[ParsedRow, ...]:
        stream = io.StringIO(content.lstrip("\ufeff"), newline="")
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            return ()
        header_map = {header: normalize_header(header) for header in reader.fieldnames if header}
        output: list[ParsedRow] = []
        for row_number, row in enumerate(reader, start=2):
            values = {
                normalized: str(row.get(original) or "").strip()
                for original, normalized in header_map.items()
                if normalized
            }
            if any(values.values()):
                output.append(ParsedRow(values=values, row_number=row_number))
        return tuple(output)
