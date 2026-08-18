from recruitintel_collectors.github.models import GitHubFile, ParsedJobListing

from .base import DocumentParser
from .common import value_for

_COMPANY = ("company", "company name", "employer", "organization")
_TITLE = ("role", "position", "job title", "title")
_LOCATION = ("location", "locations", "city")
_APPLICATION = (
    "application url",
    "application",
    "apply",
    "apply link",
    "application link",
    "url",
    "link",
)
_DESCRIPTION = ("description", "notes", "details")


class InternshipListParser:
    def __init__(self, document_parser: DocumentParser) -> None:
        self.document_parser = document_parser

    def parse(self, file: GitHubFile) -> tuple[ParsedJobListing, ...]:
        output: list[ParsedJobListing] = []
        for row in self.document_parser.parse(file.content):
            company = value_for(row, _COMPANY)
            title = value_for(row, _TITLE)
            application_url = value_for(row, _APPLICATION, prefer_link_url=True)
            if not (company or title or application_url):
                continue
            output.append(
                ParsedJobListing(
                    company_name=company or None,
                    title=title or None,
                    location=value_for(row, _LOCATION) or None,
                    application_url=application_url or None,
                    description=value_for(row, _DESCRIPTION),
                    metadata={"row_number": row.row_number},
                )
            )
        return tuple(output)
