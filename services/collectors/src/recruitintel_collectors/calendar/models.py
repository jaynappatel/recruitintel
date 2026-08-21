from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CalendarProviderName(StrEnum):
    GOOGLE = "GOOGLE"


class ExternalSyncStatus(StrEnum):
    PENDING = "PENDING"
    SYNCED = "SYNCED"
    UNCHANGED = "UNCHANGED"
    DELETED = "DELETED"
    ERROR = "ERROR"


class CalendarConnection(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    user_id: UUID
    provider: CalendarProviderName
    selected_calendar_id: str
    encrypted_refresh_token: str
    attempt_count: int
    max_attempts: int


class ExternalEventMapping(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    external_calendar_id: str
    external_event_id: str
    last_synced_hash: str | None
    sync_status: ExternalSyncStatus


class CalendarSyncItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    type: str
    title: str
    description: str | None
    starts_at: datetime
    ends_at: datetime | None
    starts_on: str | None
    ends_on: str | None
    all_day: bool
    timezone: str
    status: str
    source: str
    sync_enabled: bool
    deleted_at: datetime | None
    company_name: str | None
    job_title: str | None
    application_url: str | None
    date_certainty: str | None
    source_url: str | None
    metadata: dict[str, Any] = Field(default_factory=dict)
    mapping: ExternalEventMapping | None = None
    should_sync: bool


class ProviderEvent(BaseModel):
    model_config = ConfigDict(frozen=True)

    external_id: str
    title: str
    description: str
    starts_at: datetime
    ends_at: datetime | None
    starts_on: str | None
    ends_on: str | None
    all_day: bool
    timezone: str
    private_metadata: dict[str, str]


class CalendarSyncStats(BaseModel):
    request_id: UUID
    run_id: UUID
    attempted_items: int = 0
    created: int = 0
    updated: int = 0
    deleted: int = 0
    unchanged: int = 0
    failed: int = 0
    duration_ms: int = 0
    errors: list[dict[str, str]] = Field(default_factory=list)
