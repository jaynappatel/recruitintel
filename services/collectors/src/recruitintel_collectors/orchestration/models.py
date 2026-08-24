from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .enums import CoverageStatus, FailureClassification, WorkClass, WorkType


class ClaimedWork(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    attempt_id: UUID
    work_type: WorkType
    work_class: WorkClass
    source_id: UUID | None = None
    github_sync_request_id: UUID | None = None
    public_web_work_request_id: UUID | None = None
    calendar_sync_request_id: UUID | None = None
    recruiting_observation_id: UUID | None = None
    user_id: UUID | None = None
    lease_token: UUID
    lease_generation: int = Field(ge=1)
    lease_expires_at: datetime
    attempt_count: int = Field(ge=1)
    max_attempts: int = Field(ge=1)
    correlation_id: UUID


class WorkExecutionResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    coverage: CoverageStatus = CoverageStatus.UNKNOWN
    discovered: int | None = Field(default=None, ge=0)
    processed: int | None = Field(default=None, ge=0)
    failed: int | None = Field(default=None, ge=0)
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class WorkFailure(BaseModel):
    model_config = ConfigDict(frozen=True)

    classification: FailureClassification
    code: str = Field(pattern=r"^[A-Z][A-Z0-9_]{0,99}$")
    retry_after_seconds: int | None = Field(default=None, ge=0, le=604800)
    diagnostics: dict[str, Any] = Field(default_factory=dict)
