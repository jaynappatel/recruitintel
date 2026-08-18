from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from recruitintel_collectors.domain.enums import RoleFamily

from .enums import (
    DateCertainty,
    DatePrecision,
    PublicObservationType,
    RelevanceStatus,
    ReliabilityLevel,
    WebSourceClassification,
    WebWorkStatus,
    WebWorkType,
)


class CompanyWebConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    canonical_name: str = Field(min_length=1)
    slug: str = Field(min_length=1)
    website: str | None = None
    careers_url: str | None = None
    domains: tuple[str, ...] = ()


class SearchContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    company: CompanyWebConfig
    role_family: RoleFamily | None = None
    school_name: str | None = None
    graduation_year: int | None = Field(default=None, ge=2020, le=2040)
    focus: str = Field(default="BOTH", pattern=r"^(INTERNSHIP|NEW_GRAD|BOTH)$")


class SearchQuerySpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    template_key: str = Field(pattern=r"^[a-z0-9_-]+$")
    query: str = Field(min_length=1, max_length=1000)


class SearchResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    url: str
    title: str = ""
    snippet: str = ""
    rank: int = Field(ge=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchQueryConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    company: CompanyWebConfig
    source_id: UUID
    provider: str = Field(pattern=r"^[a-z0-9_-]+$")
    query: str = Field(min_length=1)
    minimum_interval_seconds: int = Field(ge=60)
    max_results: int = Field(ge=1, le=100)
    max_fetches: int = Field(ge=0, le=100)
    next_allowed_run_at: datetime | None = None


class CandidateConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    company: CompanyWebConfig
    source_id: UUID
    canonical_url: str
    original_url: str
    source_provider: str
    content_hash: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    fetch_status: str
    last_fetched_at: datetime | None = None


class FetchedDocument(BaseModel):
    model_config = ConfigDict(frozen=True)

    requested_url: str
    final_url: str
    status_code: int = Field(ge=200, le=299)
    content_type: str
    body: str
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    headers: dict[str, str] = Field(default_factory=dict)


class ExtractedDocument(BaseModel):
    model_config = ConfigDict(frozen=True)

    final_url: str
    title: str | None = None
    meta_description: str | None = None
    canonical_url: str | None = None
    published_at: datetime | None = None
    headings: tuple[str, ...] = ()
    text: str = Field(min_length=1)
    structured_metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("published_at")
    @classmethod
    def normalize_published_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class RelevanceDecision(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: RelevanceStatus
    score: int = Field(ge=0)
    signals: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()


class SourceAssessment(BaseModel):
    model_config = ConfigDict(frozen=True)

    classification: WebSourceClassification
    reliability_level: ReliabilityLevel
    confidence: float = Field(ge=0, le=1)
    reasons: tuple[str, ...] = ()


class DateSignal(BaseModel):
    model_config = ConfigDict(frozen=True)

    start: date | None = None
    end: date | None = None
    precision: DatePrecision
    certainty: DateCertainty
    evidence: str = Field(min_length=1)

    @model_validator(mode="after")
    def valid_range(self) -> "DateSignal":
        if self.end is not None and self.start is None:
            raise ValueError("date ranges require a start")
        if self.start is not None and self.end is not None and self.end < self.start:
            raise ValueError("date range end must not precede start")
        return self


class NormalizedWebObservation(BaseModel):
    model_config = ConfigDict(frozen=True)

    observation_type: PublicObservationType
    title: str = Field(min_length=1, max_length=500)
    summary: str = Field(min_length=1, max_length=2000)
    evidence_text: str = Field(min_length=1, max_length=4000)
    source_url: str
    occurred_at: datetime | None = None
    date_start: date | None = None
    date_end: date | None = None
    date_precision: DatePrecision = DatePrecision.UNKNOWN
    date_certainty: DateCertainty = DateCertainty.CLAIMED
    claim_subject: str = Field(min_length=1, max_length=500)
    metadata: dict[str, Any] = Field(default_factory=dict)


class StoredDocument(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    candidate_id: UUID
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    extracted: ExtractedDocument
    fetched_at: datetime


class PublicWebWorkRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    work_type: WebWorkType
    status: WebWorkStatus
    company_id: UUID
    search_query_id: UUID | None = None
    candidate_id: UUID | None = None
    attempt_count: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class WebRunStats(BaseModel):
    model_config = ConfigDict(frozen=True)

    request_id: UUID
    work_type: WebWorkType
    candidates: int = Field(default=0, ge=0)
    fetched: int = Field(default=0, ge=0)
    relevant: int = Field(default=0, ge=0)
    observations_created: int = Field(default=0, ge=0)
    events_created: int = Field(default=0, ge=0)
    recruiter_profiles_created: int = Field(default=0, ge=0)
    campus_events_created: int = Field(default=0, ge=0)
    unresolved_recruiter_references: int = Field(default=0, ge=0)
    unchanged: bool = False
    duration_ms: int = Field(default=0, ge=0)
