from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .enums import EmploymentType, ExperienceLevel, RecruitingEventType, RoleFamily


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


class SourceConfig(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    company_id: UUID
    company_name: str = Field(min_length=1)
    provider: str = Field(pattern=r"^[a-z0-9_-]+$")
    external_key: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1)
    reliability: float = Field(ge=0, le=1)
    enabled: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class CollectorTarget(BaseModel):
    model_config = ConfigDict(frozen=True)

    source: SourceConfig
    url: str
    allowed_hosts: frozenset[str]


class FetchedBatch(BaseModel):
    model_config = ConfigDict(frozen=True)

    items: list[dict[str, Any]]
    complete: bool = True
    metadata: dict[str, Any] = Field(default_factory=dict)


class NormalizedJob(BaseModel):
    model_config = ConfigDict(frozen=True, use_enum_values=False)

    external_id: str = Field(min_length=1, max_length=500)
    title: str = Field(min_length=1, max_length=1000)
    description: str = ""
    location: str = ""
    employment_type: EmploymentType = EmploymentType.UNKNOWN
    role_family: RoleFamily = RoleFamily.OTHER
    experience_level: ExperienceLevel = ExperienceLevel.UNKNOWN
    is_internship: bool = False
    is_new_grad: bool = False
    season: str | None = None
    graduation_years: tuple[int, ...] = ()
    application_url: str
    source_url: str
    published_at: datetime | None = None
    fingerprint_version: int = Field(default=1, ge=1)
    classification_version: int = Field(default=1, ge=1)
    raw_payload: dict[str, Any]

    @field_validator("published_at")
    @classmethod
    def published_at_is_utc(cls, value: datetime | None) -> datetime | None:
        return _utc(value)

    @field_validator("application_url", "source_url")
    @classmethod
    def url_is_https(cls, value: str) -> str:
        if not value.startswith("https://"):
            raise ValueError("provider URLs must use HTTPS")
        return value

    @field_validator("graduation_years")
    @classmethod
    def graduation_years_are_plausible(cls, value: tuple[int, ...]) -> tuple[int, ...]:
        years = tuple(sorted(set(value)))
        if any(year < 2020 or year > 2040 for year in years):
            raise ValueError("graduation years must be between 2020 and 2040")
        return years

    @model_validator(mode="after")
    def internship_level_is_consistent(self) -> "NormalizedJob":
        if self.is_internship and self.experience_level is not ExperienceLevel.INTERNSHIP:
            raise ValueError("internships must use the INTERNSHIP experience level")
        return self


class FingerprintedJob(BaseModel):
    model_config = ConfigDict(frozen=True)

    job: NormalizedJob
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")


class CollectorResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    source_id: UUID
    jobs: tuple[FingerprintedJob, ...]
    discovered: int = Field(ge=0)
    complete: bool
    metadata: dict[str, Any] = Field(default_factory=dict)


class SyncStats(BaseModel):
    model_config = ConfigDict(frozen=True)

    discovered: int = Field(ge=0)
    new: int = Field(ge=0)
    changed: int = Field(ge=0)
    unchanged: int = Field(ge=0)
    closed: int = Field(ge=0)


class RecruitingEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    company_id: UUID
    source_id: UUID
    job_id: UUID
    event_type: RecruitingEventType
    occurred_at: datetime
    discovered_at: datetime
    source_url: str
    confidence: float = Field(ge=0, le=1)
    fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    payload: dict[str, Any]


class StoredJob(BaseModel):
    model_config = ConfigDict(validate_assignment=True)

    id: UUID
    company_id: UUID
    source_id: UUID
    value: FingerprintedJob
    first_seen_at: datetime
    last_seen_at: datetime
    changed_at: datetime
    closed_at: datetime | None = None
    last_seen_run_id: UUID
