from datetime import UTC, date, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from recruitintel_collectors.domain.enums import RoleFamily
from recruitintel_collectors.public_web.enums import (
    DateCertainty,
    DatePrecision,
    ReliabilityLevel,
)

from .enums import (
    CampusEventType,
    FreshnessStatus,
    RecruiterEvidenceType,
    RecruiterRoleCategory,
    RelationshipStrength,
    UnresolvedRecruiterReason,
)


class SchoolReference(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    canonical_name: str = Field(min_length=1)
    aliases: tuple[str, ...] = ()
    domains: tuple[str, ...] = ()


class RecruiterObservationInput(BaseModel):
    model_config = ConfigDict(frozen=True)

    observation_id: UUID
    company_id: UUID
    company_name: str = Field(min_length=1)
    source_id: UUID
    source_url: str
    source_reliability: ReliabilityLevel
    title: str = Field(min_length=1)
    evidence_text: str = Field(min_length=1)
    observed_at: datetime
    published_at: datetime | None = None
    content_hash: str = Field(pattern=r"^[0-9a-f]{64}$")
    date_start: date | None = None
    date_end: date | None = None
    date_precision: DatePrecision = DatePrecision.UNKNOWN
    date_certainty: DateCertainty = DateCertainty.CLAIMED
    linked_school_id: UUID | None = None
    confidence: float = Field(ge=0, le=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("observed_at", "published_at")
    @classmethod
    def normalize_time(cls, value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)


class RecruiterCandidate(BaseModel):
    model_config = ConfigDict(frozen=True)

    canonical_name: str = Field(min_length=1, max_length=300)
    normalized_name: str = Field(min_length=1, max_length=300)
    first_name: str | None = None
    last_name: str | None = None
    title: str = Field(min_length=1, max_length=500)
    normalized_title: str = Field(min_length=1, max_length=500)
    categories: tuple[RecruiterRoleCategory, ...]
    location: str | None = None
    public_profile_url: str | None = None
    evidence_type: RecruiterEvidenceType
    school_ids: tuple[UUID, ...] = ()
    role_families: tuple[RoleFamily, ...] = ()
    title_match: bool = True
    explicit_company_match: bool = False
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def has_categories(self) -> "RecruiterCandidate":
        if not self.categories:
            raise ValueError("recruiter candidates require at least one category")
        return self


class CampusEventCandidate(BaseModel):
    model_config = ConfigDict(frozen=True)

    title: str = Field(min_length=1, max_length=500)
    event_type: CampusEventType
    description: str = Field(default="", max_length=4000)
    school_id: UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    date_start: date | None = None
    date_end: date | None = None
    date_precision: DatePrecision = DatePrecision.UNKNOWN
    date_certainty: DateCertainty = DateCertainty.CLAIMED
    location: str | None = None
    is_virtual: bool = False
    registration_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class UnresolvedRecruiterReference(BaseModel):
    model_config = ConfigDict(frozen=True)

    reason: UnresolvedRecruiterReason
    raw_person_name: str | None = None
    raw_company_name: str | None = None
    raw_school_name: str | None = None
    raw_title: str | None = None
    evidence_text: str = Field(min_length=1, max_length=4000)
    metadata: dict[str, Any] = Field(default_factory=dict)


class RecruiterCampusExtraction(BaseModel):
    model_config = ConfigDict(frozen=True)

    recruiters: tuple[RecruiterCandidate, ...] = ()
    campus_events: tuple[CampusEventCandidate, ...] = ()
    unresolved: tuple[UnresolvedRecruiterReference, ...] = ()


class RelationshipStrengthInput(BaseModel):
    model_config = ConfigDict(frozen=True)

    reliability: ReliabilityLevel
    independent_source_count: int = Field(ge=1)
    last_observed_at: datetime | None = None
    title_match: bool = False
    explicit_relationship: bool = False


class RelationshipStrengthDecision(BaseModel):
    model_config = ConfigDict(frozen=True)

    strength: RelationshipStrength
    reasons: tuple[str, ...]


class FreshnessDecision(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: FreshnessStatus
    age_days: int | None = Field(default=None, ge=0)


class RecruiterCampusRunStats(BaseModel):
    model_config = ConfigDict(frozen=True)

    observations_processed: int = Field(default=0, ge=0)
    people_created: int = Field(default=0, ge=0)
    recruiters_created: int = Field(default=0, ge=0)
    evidence_created: int = Field(default=0, ge=0)
    school_links_created: int = Field(default=0, ge=0)
    role_links_created: int = Field(default=0, ge=0)
    campus_events_created: int = Field(default=0, ge=0)
    unresolved_created: int = Field(default=0, ge=0)
    events_created: int = Field(default=0, ge=0)

    def plus(self, other: "RecruiterCampusRunStats") -> "RecruiterCampusRunStats":
        values = {
            name: getattr(self, name) + getattr(other, name) for name in type(self).model_fields
        }
        return RecruiterCampusRunStats(**values)
