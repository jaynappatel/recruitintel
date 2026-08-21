import os
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row
from recruitintel_collectors.calendar.encryption import AesGcmCredentialCipher
from recruitintel_collectors.calendar.models import ProviderEvent
from recruitintel_collectors.calendar.provider import CalendarProviderError
from recruitintel_collectors.calendar.runner import (
    CalendarSyncPartialFailureError,
    CalendarSyncWorker,
)
from recruitintel_collectors.infrastructure.calendar_postgres import (
    PostgresCalendarSyncRepository,
)

OWNER_ID = UUID("fa000000-0000-0000-0000-000000000001")
CONNECTION_ID = UUID("fa100000-0000-0000-0000-000000000001")
ITEM_ID = UUID("fa200000-0000-0000-0000-000000000001")
RETRY_ITEM_ID = UUID("fa200000-0000-0000-0000-000000000002")


class StaticRefresher:
    async def refresh(self, refresh_token: str) -> str:
        assert refresh_token == "postgres-refresh-token"
        return "ephemeral-access-token"


class PersistentMockProvider:
    def __init__(self) -> None:
        self.events: dict[str, ProviderEvent] = {}
        self.created = 0
        self.updated = 0
        self.deleted = 0
        self.fail_item_id: UUID | None = None

    async def create_event(self, calendar_id: str, event: ProviderEvent) -> str:
        assert calendar_id == "primary"
        if event.private_metadata["recruitintelCalendarItemId"] == str(self.fail_item_id):
            raise CalendarProviderError("access_token=provider-secret owner@example.com")
        if event.external_id not in self.events:
            self.created += 1
        self.events[event.external_id] = event
        return event.external_id

    async def update_event(
        self, calendar_id: str, external_event_id: str, event: ProviderEvent
    ) -> None:
        assert calendar_id == "primary"
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


async def connect(database_url: str) -> psycopg.AsyncConnection[dict[str, Any]]:
    return await psycopg.AsyncConnection.connect(database_url, row_factory=dict_row)


async def reset(database_url: str) -> None:
    async with await connect(database_url) as connection:
        await connection.execute(
            "delete from public.calendar_oauth_states where user_id = %s", (OWNER_ID,)
        )
        await connection.execute(
            "delete from public.calendar_connections where user_id = %s", (OWNER_ID,)
        )
        await connection.execute(
            "delete from public.calendar_items where user_id = %s", (OWNER_ID,)
        )
        await connection.execute("delete from public.users where id = %s", (OWNER_ID,))


async def enqueue(database_url: str) -> UUID:
    async with await connect(database_url) as connection:
        cursor = await connection.execute(
            """
            insert into public.calendar_sync_requests (
              calendar_connection_id, user_id
            ) values (%s, %s) returning id
            """,
            (CONNECTION_ID, OWNER_ID),
        )
        row = await cursor.fetchone()
        assert row
        return row["id"]


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_mock_provider_retry_update_delete_no_duplicates() -> None:
    test_database_url = os.environ.get("TEST_DATABASE_URL")
    if not test_database_url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    await reset(test_database_url)
    cipher = AesGcmCredentialCipher("77" * 32)
    async with await connect(test_database_url) as connection:
        await connection.execute(
            """
            insert into public.users (id, name, email, email_verified, status)
            values (%s, 'Calendar Worker User', 'calendar-worker@example.com', true, 'ACTIVE')
            """,
            (OWNER_ID,),
        )
        await connection.execute(
            """
            insert into public.calendar_items (
              id, user_id, type, title, starts_at, starts_on, all_day, timezone,
              status, source, sync_enabled
            ) values (%s, %s, 'CUSTOM', 'PostgreSQL sync contract', %s, %s, true,
              'America/Chicago', 'TODO', 'USER', true)
            """,
            (
                ITEM_ID,
                OWNER_ID,
                datetime(2026, 11, 1, tzinfo=UTC),
                datetime(2026, 11, 1).date(),
            ),
        )
        await connection.execute(
            """
            insert into public.calendar_connections (
              id, user_id, provider, provider_account_id, selected_calendar_id,
              encrypted_refresh_token, scopes, connection_status
            ) values (%s, %s, 'GOOGLE', 'mock-account', 'primary', %s,
              '{https://www.googleapis.com/auth/calendar.events.owned}', 'CONNECTED')
            """,
            (CONNECTION_ID, OWNER_ID, cipher.encrypt("postgres-refresh-token")),
        )
    repository = PostgresCalendarSyncRepository(test_database_url)
    provider = PersistentMockProvider()
    worker = CalendarSyncWorker(  # type: ignore[arg-type]
        repository=repository,
        cipher=cipher,
        token_refresher=StaticRefresher(),  # type: ignore[arg-type]
        provider_factory=lambda _token: provider,
        app_url="https://recruitintel.example",
    )

    first = await worker.run(await enqueue(test_database_url))
    retry = await worker.run(await enqueue(test_database_url))
    assert first.created == 1
    assert retry.unchanged == 1
    assert provider.created == 1

    async with await connect(test_database_url) as connection:
        await connection.execute(
            "update public.calendar_items set title = 'Changed sync contract' where id = %s",
            (ITEM_ID,),
        )
    changed = await worker.run(await enqueue(test_database_url))
    assert changed.updated == 1
    assert provider.updated == 1

    async with await connect(test_database_url) as connection:
        await connection.execute(
            """
            update public.calendar_items set status = 'CANCELLED', deleted_at = now()
            where id = %s
            """,
            (ITEM_ID,),
        )
    deleted = await worker.run(await enqueue(test_database_url))
    assert deleted.deleted == 1
    assert provider.deleted == 1

    async with await connect(test_database_url) as connection:
        await connection.execute(
            """
            insert into public.calendar_items (
              id, user_id, type, title, starts_at, starts_on, all_day, timezone,
              status, source, sync_enabled
            ) values (%s, %s, 'CUSTOM', 'Retry after partial failure', %s, %s, true,
              'America/Chicago', 'TODO', 'USER', true)
            """,
            (
                RETRY_ITEM_ID,
                OWNER_ID,
                datetime(2026, 11, 2, tzinfo=UTC),
                datetime(2026, 11, 2).date(),
            ),
        )
    retry_request_id = await enqueue(test_database_url)
    provider.fail_item_id = RETRY_ITEM_ID
    with pytest.raises(CalendarSyncPartialFailureError):
        await worker.run(retry_request_id)
    async with await connect(test_database_url) as connection:
        cursor = await connection.execute(
            """
            select r.status, c.connection_status
            from public.calendar_sync_requests r
            join public.calendar_connections c on c.id = r.calendar_connection_id
            where r.id = %s
            """,
            (retry_request_id,),
        )
        assert await cursor.fetchone() == {
            "status": "PENDING",
            "connection_status": "CONNECTED",
        }
        await connection.execute(
            "update public.calendar_sync_requests set next_attempt_at = now() where id = %s",
            (retry_request_id,),
        )
    provider.fail_item_id = None
    recovered = await worker.run(retry_request_id)
    assert recovered.created == 1

    async with await connect(test_database_url) as connection:
        cursor = await connection.execute(
            """
            select count(*)::int as mappings,
              count(*) filter (where sync_status = 'DELETED')::int as deleted_mappings
            from public.calendar_external_events
            where calendar_item_id = %s and calendar_connection_id = %s
            """,
            (ITEM_ID, CONNECTION_ID),
        )
        row = await cursor.fetchone()
        assert row == {"mappings": 1, "deleted_mappings": 1}
        cursor = await connection.execute(
            """
            select count(*)::int as runs from public.calendar_sync_runs
            where calendar_connection_id = %s and status = 'SUCCEEDED'
            """,
            (CONNECTION_ID,),
        )
        assert (await cursor.fetchone()) == {"runs": 5}
        cursor = await connection.execute(
            """
            select errors::text as errors from public.calendar_sync_runs
            where calendar_connection_id = %s and status = 'FAILED'
            """,
            (CONNECTION_ID,),
        )
        failed_diagnostics = await cursor.fetchone()
        assert failed_diagnostics is not None
        assert "provider-secret" not in failed_diagnostics["errors"]
        assert "owner@example.com" not in failed_diagnostics["errors"]
    await reset(test_database_url)
