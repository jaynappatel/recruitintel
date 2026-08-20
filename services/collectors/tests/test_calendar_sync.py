import json
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.exceptions import InvalidTag
from recruitintel_collectors.calendar.encryption import AesGcmCredentialCipher
from recruitintel_collectors.calendar.models import (
    CalendarConnection,
    CalendarProviderName,
    CalendarSyncItem,
    ExternalEventMapping,
    ExternalSyncStatus,
    ProviderEvent,
)
from recruitintel_collectors.calendar.provider import (
    CalendarProviderError,
    GoogleCalendarProvider,
    RefreshCredentialInvalidError,
)
from recruitintel_collectors.calendar.runner import (
    CalendarSyncPartialFailureError,
    CalendarSyncWorker,
    deterministic_external_event_id,
    provider_event_for,
    provider_event_hash,
)


class FakeRefresher:
    def __init__(self, *, revoked: bool = False) -> None:
        self.revoked = revoked

    async def refresh(self, refresh_token: str) -> str:
        assert refresh_token == "refresh-token"
        if self.revoked:
            raise RefreshCredentialInvalidError
        return "ephemeral-access-token"


class FakeProvider:
    def __init__(self, *, fail_item_id: UUID | None = None) -> None:
        self.events: dict[str, ProviderEvent] = {}
        self.created = 0
        self.updated = 0
        self.deleted = 0
        self.fail_item_id = fail_item_id

    def _maybe_fail(self, event: ProviderEvent) -> None:
        if self.fail_item_id and event.private_metadata["recruitintelCalendarItemId"] == str(
            self.fail_item_id
        ):
            raise CalendarProviderError("MOCK_PARTIAL_FAILURE")

    async def create_event(self, calendar_id: str, event: ProviderEvent) -> str:
        assert calendar_id == "primary"
        self._maybe_fail(event)
        self.events[event.external_id] = event
        self.created += 1
        return event.external_id

    async def update_event(
        self, calendar_id: str, external_event_id: str, event: ProviderEvent
    ) -> None:
        assert calendar_id == "primary"
        self._maybe_fail(event)
        self.events[external_event_id] = event
        self.updated += 1

    async def delete_event(self, calendar_id: str, external_event_id: str) -> None:
        assert calendar_id == "primary"
        self.events.pop(external_event_id, None)
        self.deleted += 1

    async def get_event(self, calendar_id: str, external_event_id: str) -> dict[str, Any]:
        assert calendar_id == "primary"
        return {"id": external_event_id}

    async def aclose(self) -> None:
        return None


class FakeRepository:
    def __init__(self, connection: CalendarConnection, items: list[CalendarSyncItem]) -> None:
        self.connection = connection
        self.items = items
        self.saved: dict[UUID, tuple[str, str]] = {}
        self.marked: list[tuple[UUID, ExternalSyncStatus, str | None]] = []
        self.completed = False
        self.failed: dict[str, Any] | None = None

    async def claim(self, request_id: UUID) -> tuple[CalendarConnection, UUID]:
        return self.connection, uuid4()

    async def list_items(self, calendar_connection_id: UUID) -> list[CalendarSyncItem]:
        assert calendar_connection_id == self.connection.id
        return self.items

    async def save_mapping(
        self,
        *,
        item_id: UUID,
        connection_id: UUID,
        calendar_id: str,
        external_event_id: str,
        content_hash: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        assert connection_id == self.connection.id
        self.saved[item_id] = (external_event_id, content_hash)

    async def mark_mapping(
        self,
        mapping_id: UUID,
        status: ExternalSyncStatus,
        *,
        content_hash: str | None = None,
        error_code: str | None = None,
    ) -> None:
        self.marked.append((mapping_id, status, error_code))

    async def complete(self, stats: Any) -> None:
        self.completed = True

    async def fail(self, stats: Any, **values: Any) -> None:
        self.failed = values


def connection(cipher: AesGcmCredentialCipher) -> CalendarConnection:
    return CalendarConnection(
        id=uuid4(),
        owner_id=uuid4(),
        provider=CalendarProviderName.GOOGLE,
        selected_calendar_id="primary",
        encrypted_refresh_token=cipher.encrypt("refresh-token"),
        attempt_count=1,
        max_attempts=3,
    )


def item(
    *,
    item_id: UUID | None = None,
    title: str = "LeetCode Prep — Graphs",
    should_sync: bool = True,
    mapping: ExternalEventMapping | None = None,
) -> CalendarSyncItem:
    return CalendarSyncItem(
        id=item_id or uuid4(),
        type="LEETCODE",
        title=title,
        description="Reported topics guide practice but are not guaranteed content.",
        starts_at=datetime.fromisoformat("2026-11-01T15:00:00-06:00"),
        ends_at=datetime.fromisoformat("2026-11-01T16:00:00-06:00"),
        starts_on=None,
        ends_on=None,
        all_day=False,
        timezone="America/Chicago",
        status="TODO",
        source="APPLICATION_PLAN",
        sync_enabled=True,
        deleted_at=None,
        company_name="Meta",
        job_title="Software Engineer Intern",
        application_url="https://example.com/jobs/meta-intern",
        date_certainty=None,
        source_url=None,
        metadata={},
        mapping=mapping,
        should_sync=should_sync,
    )


def worker(
    repository: FakeRepository,
    cipher: AesGcmCredentialCipher,
    provider: FakeProvider,
    *,
    revoked: bool = False,
) -> CalendarSyncWorker:
    return CalendarSyncWorker(  # type: ignore[arg-type]
        repository=repository,
        cipher=cipher,
        token_refresher=FakeRefresher(revoked=revoked),  # type: ignore[arg-type]
        provider_factory=lambda _access_token: provider,
        app_url="https://recruitintel.example",
    )


@pytest.mark.asyncio
async def test_first_create_and_unchanged_retry_do_not_duplicate() -> None:
    cipher = AesGcmCredentialCipher("11" * 32)
    connected = connection(cipher)
    sync_item = item()
    provider = FakeProvider()
    first_repository = FakeRepository(connected, [sync_item])
    first = await worker(first_repository, cipher, provider).run(uuid4())
    assert first.created == 1
    assert provider.created == 1
    external_id, content_hash = first_repository.saved[sync_item.id]

    mapping = ExternalEventMapping(
        id=uuid4(),
        external_calendar_id="primary",
        external_event_id=external_id,
        last_synced_hash=content_hash,
        sync_status=ExternalSyncStatus.SYNCED,
    )
    retry_repository = FakeRepository(
        connected, [sync_item.model_copy(update={"mapping": mapping})]
    )
    retry = await worker(retry_repository, cipher, provider).run(uuid4())
    assert retry.unchanged == 1
    assert provider.created == 1
    assert provider.updated == 0


@pytest.mark.asyncio
async def test_changed_item_updates_existing_event_and_cancelled_item_deletes_it() -> None:
    cipher = AesGcmCredentialCipher("22" * 32)
    connected = connection(cipher)
    sync_item = item()
    event = provider_event_for(connected, sync_item, app_url=None)
    mapping = ExternalEventMapping(
        id=uuid4(),
        external_calendar_id="primary",
        external_event_id=event.external_id,
        last_synced_hash="a" * 64,
        sync_status=ExternalSyncStatus.SYNCED,
    )
    provider = FakeProvider()
    update_repository = FakeRepository(
        connected, [sync_item.model_copy(update={"mapping": mapping})]
    )
    updated = await worker(update_repository, cipher, provider).run(uuid4())
    assert updated.updated == 1
    assert provider.updated == 1

    delete_repository = FakeRepository(
        connected,
        [sync_item.model_copy(update={"mapping": mapping, "should_sync": False})],
    )
    deleted = await worker(delete_repository, cipher, provider).run(uuid4())
    assert deleted.deleted == 1
    assert provider.deleted == 1


@pytest.mark.asyncio
async def test_partial_failure_is_recorded_and_successful_items_remain_mapped() -> None:
    cipher = AesGcmCredentialCipher("33" * 32)
    connected = connection(cipher)
    failed_item = item()
    successful_item = item()
    provider = FakeProvider(fail_item_id=failed_item.id)
    repository = FakeRepository(connected, [failed_item, successful_item])
    with pytest.raises(CalendarSyncPartialFailureError):
        await worker(repository, cipher, provider).run(uuid4())
    assert successful_item.id in repository.saved
    assert failed_item.id not in repository.saved
    assert repository.failed and repository.failed["retryable"] is True


@pytest.mark.asyncio
async def test_revoked_refresh_token_transitions_to_reconnect_required() -> None:
    cipher = AesGcmCredentialCipher("44" * 32)
    connected = connection(cipher)
    repository = FakeRepository(connected, [item()])
    with pytest.raises(RefreshCredentialInvalidError):
        await worker(repository, cipher, FakeProvider(), revoked=True).run(uuid4())
    assert repository.failed and repository.failed["reconnect_required"] is True
    assert repository.saved == {}


def test_token_encryption_round_trip_and_tamper_rejection() -> None:
    cipher = AesGcmCredentialCipher("55" * 32)
    envelope = cipher.encrypt("refresh-token")
    assert "refresh-token" not in envelope
    assert cipher.decrypt(envelope) == "refresh-token"
    parts = envelope.split(".")
    parts[3] = ("B" if parts[3].startswith("A") else "A") + parts[3][1:]
    with pytest.raises(InvalidTag):
        cipher.decrypt(".".join(parts))


def test_deterministic_external_id_and_content_hash() -> None:
    cipher = AesGcmCredentialCipher("66" * 32)
    connected = connection(cipher)
    sync_item = item()
    assert deterministic_external_event_id(connected.id, sync_item.id) == (
        deterministic_external_event_id(connected.id, sync_item.id)
    )
    event = provider_event_for(connected, sync_item, app_url=None)
    assert provider_event_hash(event) == provider_event_hash(event.model_copy())


@pytest.mark.asyncio
async def test_google_provider_preserves_all_day_date_and_timed_timezone() -> None:
    bodies: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"id": bodies[-1]["id"]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = GoogleCalendarProvider("access-token", client=client)
    all_day = ProviderEvent(
        external_id="ri12345",
        title="RecruitIntel: Career Fair",
        description="Company: Example",
        starts_at=datetime.fromisoformat("2026-11-01T00:00:00+00:00"),
        ends_at=None,
        starts_on="2026-11-01",
        ends_on=None,
        all_day=True,
        timezone="America/Chicago",
        private_metadata={"managed": "true"},
    )
    timed = ProviderEvent(
        external_id="ri67890",
        title="RecruitIntel: Timed Prep",
        description="Company: Example",
        starts_at=datetime.fromisoformat("2026-03-08T01:30:00-06:00"),
        ends_at=datetime.fromisoformat("2026-03-08T03:30:00-05:00"),
        starts_on=None,
        ends_on=None,
        all_day=False,
        timezone="America/Chicago",
        private_metadata={"managed": "true"},
    )
    await provider.create_event("primary", all_day)
    await provider.create_event("primary", timed)
    await provider.aclose()
    await client.aclose()
    assert bodies[0]["start"] == {"date": "2026-11-01"}
    assert bodies[0]["end"] == {"date": "2026-11-02"}
    assert bodies[1]["start"]["dateTime"] == "2026-03-08T01:30:00-06:00"
    assert bodies[1]["start"]["timeZone"] == "America/Chicago"
