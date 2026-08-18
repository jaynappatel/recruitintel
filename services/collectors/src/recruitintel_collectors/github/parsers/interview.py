from recruitintel_collectors.github.models import GitHubFile, ParsedInterviewQuestion

from .base import DocumentParser
from .common import markdown_link_url, value_for

_COMPANY = ("company", "company name", "employer", "organization")
_QUESTION = ("question", "question title", "problem", "problem title", "leetcode question", "title")
_URL = ("problem url", "leetcode url", "question url", "url", "link")
_DIFFICULTY = ("difficulty", "level")
_TOPICS = ("topics", "topic", "tags", "category")
_ROLE = ("role family", "role", "position")
_STAGE = ("interview stage", "stage", "round")


class InterviewQuestionParser:
    def __init__(self, document_parser: DocumentParser) -> None:
        self.document_parser = document_parser

    def parse(self, file: GitHubFile) -> tuple[ParsedInterviewQuestion, ...]:
        output: list[ParsedInterviewQuestion] = []
        for row in self.document_parser.parse(file.content):
            raw_title = value_for(row, _QUESTION)
            problem_url = value_for(row, _URL, prefer_link_url=True)
            if not problem_url:
                problem_url = next(
                    (
                        url
                        for alias in _QUESTION
                        if (value := row.values.get(alias)) and (url := markdown_link_url(value))
                    ),
                    "",
                )
            if not raw_title and not problem_url:
                continue
            topics = tuple(
                part.strip()
                for part in value_for(row, _TOPICS).replace("|", ",").split(",")
                if part.strip()
            )
            output.append(
                ParsedInterviewQuestion(
                    company_name=value_for(row, _COMPANY) or None,
                    raw_title=raw_title or None,
                    problem_url=problem_url or None,
                    difficulty=value_for(row, _DIFFICULTY) or None,
                    topics=topics,
                    role_family=value_for(row, _ROLE) or None,
                    interview_stage=value_for(row, _STAGE) or None,
                    metadata={"row_number": row.row_number},
                )
            )
        return tuple(output)
