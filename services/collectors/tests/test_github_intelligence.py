from pathlib import Path
from uuid import UUID

import pytest
from recruitintel_collectors.github.enums import GitHubParserType, GitHubRepositoryType
from recruitintel_collectors.github.models import (
    GitHubFile,
    GitHubRepositoryConfig,
    GitHubRepositoryLink,
)
from recruitintel_collectors.github.normalization import (
    normalize_interview_question,
    parse_github_url,
)
from recruitintel_collectors.github.normalize_records import GitHubRecordNormalizer
from recruitintel_collectors.github.parsers import (
    CSVParser,
    InterviewQuestionParser,
    MarkdownTableParser,
    ParserRegistry,
)
from recruitintel_collectors.github.resolution import GitHubCompanyResolver
from recruitintel_collectors.github.runner import has_relevant_sha_change

FIXTURES = Path(__file__).parent / "fixtures"
META_ID = UUID("a1000000-0000-0000-0000-000000000001")
GOOGLE_ID = UUID("a1000000-0000-0000-0000-000000000002")
REPOSITORY_ID = UUID("a2000000-0000-0000-0000-000000000001")
SOURCE_ID = UUID("a3000000-0000-0000-0000-000000000001")


def _text(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _repository(
    *,
    parser_type: GitHubParserType = GitHubParserType.AUTO,
    repository_type: GitHubRepositoryType = GitHubRepositoryType.INTERVIEW_QUESTIONS,
) -> GitHubRepositoryConfig:
    return GitHubRepositoryConfig(
        id=REPOSITORY_ID,
        source_id=SOURCE_ID,
        owner="recruitintel-tests",
        repository_name="synthetic-intelligence",
        repository_url="https://github.com/recruitintel-tests/synthetic-intelligence",
        repository_type=repository_type,
        parser_type=parser_type,
        reliability=0.7,
        links=(
            GitHubRepositoryLink(
                company_id=META_ID,
                company_name="Meta",
                watched_paths=("questions.md",),
                company_mapping_rules={"aliases": ["Meta Platforms"]},
            ),
        ),
    )


@pytest.mark.parametrize(
    ("value", "owner", "repository"),
    [
        ("https://github.com/OpenAI/openai-python", "openai", "openai-python"),
        ("https://github.com/Owner/Repo.git", "owner", "repo"),
    ],
)
def test_github_url_parsing(value: str, owner: str, repository: str) -> None:
    parsed = parse_github_url(value)
    assert parsed.owner == owner
    assert parsed.repository_name == repository


@pytest.mark.parametrize(
    "value",
    [
        "http://github.com/openai/openai-python",
        "https://github.com/openai/openai-python/issues",
        "https://user:token@github.com/openai/openai-python",
        "https://evil.example/openai/openai-python",
    ],
)
def test_github_url_parsing_rejects_unsafe_or_non_repository_urls(value: str) -> None:
    with pytest.raises(ValueError):
        parse_github_url(value)


def test_sha_change_detection_is_exact() -> None:
    sha = "a" * 40
    assert not has_relevant_sha_change(sha, sha)
    assert has_relevant_sha_change(None, sha)
    assert has_relevant_sha_change("b" * 40, sha)


def test_markdown_and_csv_parsers_preserve_row_metadata() -> None:
    markdown_rows = MarkdownTableParser().parse(_text("github_interview_questions.md"))
    csv_rows = CSVParser().parse(_text("github_interview_questions.csv"))
    assert len(markdown_rows) == 4
    assert markdown_rows[0].values["company"] == "Meta"
    assert markdown_rows[0].row_number > 1
    assert len(csv_rows) == 2
    assert csv_rows[1].values["company"] == "Google"


def test_parser_selection_and_semantic_markdown_parsing() -> None:
    repository = _repository(parser_type=GitHubParserType.MARKDOWN_TABLE)
    file = GitHubFile(
        path="questions.md",
        source_url=f"{repository.repository_url}/blob/{'a' * 40}/questions.md",
        commit_sha="a" * 40,
        content=_text("github_interview_questions.md"),
    )
    parser = ParserRegistry()
    assert isinstance(
        parser.select_document_parser(GitHubParserType.AUTO, "questions.md"),
        MarkdownTableParser,
    )
    questions = InterviewQuestionParser(MarkdownTableParser()).parse(file)
    records = parser.parse(repository, file)
    assert len(questions) == 4
    assert len(records) == 4
    assert questions[2].problem_url == "https://leetcode.com/problems/two-sum/"


def test_question_normalization_deduplicates_supported_formats() -> None:
    variants = (
        normalize_interview_question(raw_title="LC 200 - Number of Islands"),
        normalize_interview_question(raw_title="200. Number of Islands"),
        normalize_interview_question(raw_title="Number of Islands"),
        normalize_interview_question(raw_title="leetcode.com/problems/number-of-islands"),
    )
    assert {question.normalized_title for question in variants} == {"number of islands"}
    assert {question.leetcode_number for question in variants[:2]} == {200}
    assert variants[3].leetcode_slug == "number-of-islands"


def test_company_resolution_uses_global_and_repository_aliases_without_guessing() -> None:
    resolver = GitHubCompanyResolver(
        aliases={"Meta": META_ID, "Facebook": META_ID, "Google": GOOGLE_ID},
        domains={},
        links=_repository().links,
    )
    assert resolver.resolve("Meta Platforms") == META_ID
    assert resolver.resolve("Facebook") == META_ID
    assert resolver.resolve("Unknown Robotics") is None


def test_multi_company_job_normalization_reuses_job_model_and_preserves_unresolved() -> None:
    repository = _repository(
        repository_type=GitHubRepositoryType.NEW_GRAD_LIST,
        parser_type=GitHubParserType.AUTO,
    )
    resolver = GitHubCompanyResolver(
        aliases={"Meta": META_ID, "Google": GOOGLE_ID},
        domains={},
        links=repository.links,
    )
    sha = "b" * 40
    file = GitHubFile(
        path="jobs.csv",
        source_url=f"{repository.repository_url}/blob/{sha}/jobs.csv",
        commit_sha=sha,
        content=_text("github_multi_company_jobs.csv"),
    )
    batch = GitHubRecordNormalizer().normalize_file(
        repository=repository, file=file, company_resolver=resolver
    )
    assert len(batch.jobs) == 2
    assert batch.jobs[0].job.raw_payload["commit_sha"] == sha
    assert batch.jobs[0].source_path == "jobs.csv"
    assert batch.jobs[1].job.is_new_grad
    assert len(batch.unresolved) == 1
    assert batch.unresolved[0].raw_company_name == "Unknown Robotics"
