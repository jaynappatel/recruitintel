from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from recruitintel_collectors.domain.enums import RoleFamily
from recruitintel_collectors.domain.models import NormalizedJob
from recruitintel_collectors.domain.normalization import normalize_text

from .enums import GitHubParserType, GitHubRecordType, GitHubRepositoryType, QuestionDifficulty
from .paths import normalize_watched_path


class GitHubCoordinates(BaseModel):
    model_config = ConfigDict(frozen=True)

    owner: str
    repository_name: str
    repository_url: str


class GitHubRepositoryLink(BaseModel):
    model_config = ConfigDict(frozen=True)

    company_id: UUID
    company_name: str = Field(min_length=1)
    watched_paths: tuple[str, ...]
    company_mapping_rules: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True

    @field_validator("watched_paths")
    @classmethod
    def paths_are_safe(cls, value: tuple[str, ...]) -> tuple[str, ...]:
        return tuple(sorted({normalize_watched_path(path) for path in value}))


class GitHubRepositoryConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    source_id: UUID
    owner: str
    repository_name: str
    repository_url: str
    default_branch: str | None = None
    repository_type: GitHubRepositoryType
    parser_type: GitHubParserType
    enabled: bool = True
    last_seen_commit_sha: str | None = None
    last_processed_commit_sha: str | None = None
    reliability: float = Field(ge=0, le=1)
    links: tuple[GitHubRepositoryLink, ...]
    metadata: dict[str, Any] = Field(default_factory=dict)

    @property
    def watched_paths(self) -> tuple[str, ...]:
        return tuple(
            sorted({path for link in self.links if link.enabled for path in link.watched_paths})
        )


class GitHubRateLimit(BaseModel):
    model_config = ConfigDict(frozen=True)

    limit: int | None = Field(default=None, ge=0)
    remaining: int | None = Field(default=None, ge=0)
    reset_at: datetime | None = None
    used: int | None = Field(default=None, ge=0)


class GitHubRepositoryMetadata(BaseModel):
    model_config = ConfigDict(frozen=True)

    owner: str
    repository_name: str
    repository_url: str
    default_branch: str
    archived: bool = False
    disabled: bool = False


class GitHubChangedFile(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: str
    status: str
    previous_path: str | None = None


class GitHubComparison(BaseModel):
    model_config = ConfigDict(frozen=True)

    files: tuple[GitHubChangedFile, ...]
    complete: bool = True


class GitHubFile(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: str
    source_url: str
    commit_sha: str
    content: str
    content_sha: str | None = None


class ParsedInterviewQuestion(BaseModel):
    model_config = ConfigDict(frozen=True)

    record_type: GitHubRecordType = GitHubRecordType.INTERVIEW_QUESTION
    company_name: str | None = None
    raw_title: str | None = None
    problem_url: str | None = None
    difficulty: str | None = None
    topics: tuple[str, ...] = ()
    role_family: str | None = None
    interview_stage: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ParsedJobListing(BaseModel):
    model_config = ConfigDict(frozen=True)

    record_type: GitHubRecordType = GitHubRecordType.JOB
    company_name: str | None = None
    title: str | None = None
    location: str | None = None
    application_url: str | None = None
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class NormalizedInterviewQuestion(BaseModel):
    model_config = ConfigDict(frozen=True)

    canonical_title: str = Field(min_length=1)
    normalized_title: str = Field(min_length=1)
    leetcode_slug: str | None = None
    leetcode_number: int | None = Field(default=None, gt=0)
    difficulty: QuestionDifficulty | None = None
    topics: tuple[str, ...] = ()


class ResolvedInterviewQuestion(BaseModel):
    model_config = ConfigDict(frozen=True)

    company_id: UUID
    question: NormalizedInterviewQuestion
    raw_title: str
    source_path: str
    source_url: str
    commit_sha: str
    role_family: RoleFamily | None = None
    interview_stage: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("raw_title", "source_path")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        return normalize_text(value)

    @field_validator("interview_stage")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        normalized = normalize_text(value)
        return normalized or None


class ResolvedGitHubJob(BaseModel):
    model_config = ConfigDict(frozen=True)

    company_id: UUID
    source_path: str
    source_url: str
    commit_sha: str
    external_id: str
    job: NormalizedJob


class UnresolvedGitHubRecord(BaseModel):
    model_config = ConfigDict(frozen=True)

    record_type: GitHubRecordType
    source_path: str
    source_url: str
    commit_sha: str
    reason: str = Field(min_length=1)
    raw_company_name: str | None = None
    raw_title: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class GitHubParsedBatch(BaseModel):
    model_config = ConfigDict(frozen=True)

    questions: tuple[ResolvedInterviewQuestion, ...] = ()
    jobs: tuple[ResolvedGitHubJob, ...] = ()
    unresolved: tuple[UnresolvedGitHubRecord, ...] = ()

    @property
    def count(self) -> int:
        return len(self.questions) + len(self.jobs) + len(self.unresolved)


class GitHubSyncStats(BaseModel):
    model_config = ConfigDict(frozen=True)

    repository_id: UUID
    previous_sha: str | None = None
    current_sha: str
    files_inspected: int = Field(ge=0)
    records_parsed: int = Field(ge=0)
    new: int = Field(ge=0)
    updated: int = Field(ge=0)
    unchanged: int = Field(ge=0)
    unresolved: int = Field(ge=0)
    errors: int = Field(ge=0)
    skipped_unchanged_sha: bool = False
    duration_ms: int = Field(ge=0)
