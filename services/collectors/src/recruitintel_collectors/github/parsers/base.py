from dataclasses import dataclass
from typing import Protocol

from recruitintel_collectors.github.models import (
    GitHubFile,
    ParsedInterviewQuestion,
    ParsedJobListing,
)


@dataclass(frozen=True, slots=True)
class ParsedRow:
    values: dict[str, str]
    row_number: int


class DocumentParser(Protocol):
    def parse(self, content: str) -> tuple[ParsedRow, ...]: ...


class RecordParser(Protocol):
    def parse(self, file: GitHubFile) -> tuple[ParsedInterviewQuestion | ParsedJobListing, ...]: ...
