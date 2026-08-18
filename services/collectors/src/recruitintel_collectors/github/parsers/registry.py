from pathlib import PurePosixPath

from recruitintel_collectors.github.enums import GitHubParserType, GitHubRepositoryType
from recruitintel_collectors.github.models import (
    GitHubFile,
    GitHubRepositoryConfig,
    ParsedInterviewQuestion,
    ParsedJobListing,
)

from .base import DocumentParser
from .csv_parser import CSVParser
from .internship import InternshipListParser
from .interview import InterviewQuestionParser
from .json_parser import JSONParser
from .markdown import MarkdownTableParser


class ParserRegistry:
    def select_document_parser(
        self, parser_type: GitHubParserType, source_path: str
    ) -> DocumentParser:
        if parser_type is GitHubParserType.MARKDOWN_TABLE:
            return MarkdownTableParser()
        if parser_type is GitHubParserType.CSV:
            return CSVParser()
        if parser_type is GitHubParserType.JSON:
            return JSONParser()

        suffix = PurePosixPath(source_path).suffix.casefold()
        if suffix in {".md", ".markdown"}:
            return MarkdownTableParser()
        if suffix in {".csv", ".tsv"}:
            return CSVParser()
        if suffix == ".json":
            return JSONParser()
        raise ValueError(f"no safe parser is registered for {source_path!r}")

    def parse(
        self, repository: GitHubRepositoryConfig, file: GitHubFile
    ) -> tuple[ParsedInterviewQuestion | ParsedJobListing, ...]:
        document = self.select_document_parser(repository.parser_type, file.path)
        if repository.parser_type is GitHubParserType.INTERVIEW_QUESTIONS:
            return InterviewQuestionParser(document).parse(file)
        if repository.parser_type is GitHubParserType.INTERNSHIP_LIST:
            return InternshipListParser(document).parse(file)
        if repository.repository_type is GitHubRepositoryType.INTERVIEW_QUESTIONS:
            return InterviewQuestionParser(document).parse(file)
        if repository.repository_type in {
            GitHubRepositoryType.INTERNSHIP_LIST,
            GitHubRepositoryType.NEW_GRAD_LIST,
        }:
            return InternshipListParser(document).parse(file)
        raise ValueError(
            "AUTO/generic parsing requires an INTERVIEW_QUESTIONS, INTERNSHIP_LIST, "
            "or NEW_GRAD_LIST repository type"
        )
