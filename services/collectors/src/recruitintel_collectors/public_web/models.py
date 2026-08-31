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
    SearchResultKind,
    SourceDiscoveryMethod,
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


class SearchRequest(BaseModel):
    """Provider-neutral, bounded search input."""

    model_config = ConfigDict(frozen=True)

    query: str = Field(min_length=1, max_length=1000)
    max_results: int = Field(ge=1, le=100)
    country_code: str | None = Field(default=None, pattern=r"^[A-Z]{2}$")
    language: str | None = Field(default=None, pattern=r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
    freshness: str | None = Field(
        default=None,
        pattern=r"^(?:day|week|month|year|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$",
    )
    include_domains: tuple[str, ...] = Field(default=(), max_length=500)
    exclude_domains: tuple[str, ...] = Field(default=(), max_length=500)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        normalized = " ".join(value.split())
        if not normalized:
            raise ValueError("query must not be blank")
        return normalized

    @field_validator("include_domains", "exclude_domains")
    @classmethod
    def normalize_domains(cls, values: tuple[str, ...]) -> tuple[str, ...]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            candidate = value.strip().casefold().rstrip(".")
            if not candidate or any(character in candidate for character in "/:@* "):
                raise ValueError("search domains must be bare hostnames")
            try:
                candidate = candidate.encode("idna").decode("ascii")
            except UnicodeError as exc:
                raise ValueError("search domain is invalid") from exc
            labels = candidate.split(".")
            if (
                len(candidate) > 253
                or any(not label or len(label) > 63 for label in labels)
                or any(label.startswith("-") or label.endswith("-") for label in labels)
                or any(
                    not all(character.isalnum() or character == "-" for character in label)
                    for label in labels
                )
            ):
                raise ValueError("search domain is invalid")
            if candidate not in seen:
                seen.add(candidate)
                normalized.append(candidate)
        return tuple(normalized)

    @model_validator(mode="after")
    def mutually_exclusive_domains(self) -> "SearchRequest":
        if self.include_domains and self.exclude_domains:
            raise ValueError("include_domains and exclude_domains cannot be combined")
        return self


class SearchResultMetadata(BaseModel):
    """Strictly allowlisted search-result provenance."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    page_offset: int | None = Field(default=None, ge=0, le=9)
    section_rank: int | None = Field(default=None, ge=1, le=100)


class SearchResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    url: str = Field(min_length=1, max_length=8192)
    title: str = Field(default="", max_length=500)
    snippet: str = Field(default="", max_length=2000)
    rank: int = Field(ge=1)
    result_kind: SearchResultKind = SearchResultKind.WEB
    published_at: datetime | None = None
    metadata: SearchResultMetadata = Field(default_factory=SearchResultMetadata)

    @field_validator("published_at")
    @classmethod
    def normalize_result_published_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class SearchBatch(BaseModel):
    model_config = ConfigDict(frozen=True)

    results: tuple[SearchResult, ...] = Field(max_length=100)
    provider_calls: int = Field(ge=0)
    cost_units: int = Field(ge=0)
    estimated_cost_micros: int = Field(ge=0)
    paid_spend_micros: int = Field(default=0, ge=0)
    quota_remaining: int | None = Field(default=None, ge=0)
    quota_reset_at: datetime | None = None
    truncated: bool = False

    @field_validator("quota_reset_at")
    @classmethod
    def normalize_quota_reset_at(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    @model_validator(mode="after")
    def paid_spend_cannot_exceed_estimate(self) -> "SearchBatch":
        if self.paid_spend_micros > self.estimated_cost_micros:
            raise ValueError("paid spend cannot exceed estimated cost")
        return self


class SearchQueryConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    company: CompanyWebConfig
    source_id: UUID
    provider: str = Field(pattern=r"^[a-z0-9_-]+$")
    template_key: str = Field(pattern=r"^[a-z0-9_-]+$")
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


class DirectSourceEndpoint(BaseModel):
    """Bounded durable source knowledge derived from an already permitted page."""

    model_config = ConfigDict(frozen=True)

    url: str = Field(min_length=1, max_length=8192)
    source_type: str = Field(pattern=r"^(ATS|COMPANY_CAREERS|UNIVERSITY|GITHUB)$")
    provider: str = Field(pattern=r"^[a-z0-9_-]+$")
    external_key: str = Field(min_length=1, max_length=500)
    name: str = Field(min_length=1, max_length=500)
    discovery_method: SourceDiscoveryMethod
    confidence: float = Field(ge=0, le=1)
    discovered_from_url: str = Field(min_length=1, max_length=8192)
    evidence: str = Field(min_length=1, max_length=500)
    ats_type: str | None = Field(
        default=None,
        pattern=r"^(GREENHOUSE|LEVER|ASHBY|WORKDAY|SMARTRECRUITERS|ICIMS|SUCCESSFACTORS|BAMBOOHR|OTHER)$",
    )
    collector_supported: bool = False
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")


class KnownSourceCoverage(BaseModel):
    model_config = ConfigDict(frozen=True)

    url: str
    source_type: str = Field(pattern=r"^(ATS|COMPANY_CAREERS|UNIVERSITY|GITHUB)$")
    enabled: bool = True


class DirectDiscoveryPlan(BaseModel):
    model_config = ConfigDict(frozen=True)

    probe_urls: tuple[str, ...] = Field(max_length=5)
    general_search_recommended: bool
    reason: str = Field(min_length=1, max_length=100)


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
    provider_calls: int = Field(default=0, ge=0)
    cost_units: int = Field(default=0, ge=0)
    estimated_cost_micros: int = Field(default=0, ge=0)
    paid_spend_micros: int = Field(default=0, ge=0)
    direct_sources_discovered: int = Field(default=0, ge=0)
    general_search_skipped: bool = False
    fetched: int = Field(default=0, ge=0)
    relevant: int = Field(default=0, ge=0)
    observations_created: int = Field(default=0, ge=0)
    events_created: int = Field(default=0, ge=0)
    recruiter_profiles_created: int = Field(default=0, ge=0)
    campus_events_created: int = Field(default=0, ge=0)
    unresolved_recruiter_references: int = Field(default=0, ge=0)
    unchanged: bool = False
    duration_ms: int = Field(default=0, ge=0)
