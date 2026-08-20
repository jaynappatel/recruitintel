from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from recruitintel_collectors.calendar.models import (
    CalendarConnection,
    CalendarProviderName,
    CalendarSyncItem,
    CalendarSyncStats,
    ExternalEventMapping,
    ExternalSyncStatus,
)


class PostgresCalendarSyncRepository:
    def __init__(self, database_url: str) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    async def claim(self, request_id: UUID) -> tuple[CalendarConnection, UUID]:
        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = await connection.execute(
                    """
                    select r.*, c.owner_id, c.provider, c.selected_calendar_id,
                           c.encrypted_refresh_token, c.connection_status
                    from public.calendar_sync_requests r
                    join public.calendar_connections c on c.id = r.calendar_connection_id
                    where r.id = %s
                    for update of r
                    """,
                    (request_id,),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise KeyError(f"calendar sync request {request_id} was not found")
                if row["status"] != "PENDING" or row["next_attempt_at"] > datetime.now(UTC):
                    raise RuntimeError("calendar sync request is not claimable")
                if row["connection_status"] != "CONNECTED" or not row["encrypted_refresh_token"]:
                    raise RuntimeError("calendar connection is not connected")
                await connection.execute(
                    """
                    update public.calendar_sync_requests set status = 'RUNNING',
                      attempt_count = attempt_count + 1, started_at = now(),
                      finished_at = null, error_code = null
                    where id = %s
                    """,
                    (request_id,),
                )
                cursor = await connection.execute(
                    """
                    insert into public.calendar_sync_runs (
                      calendar_sync_request_id, calendar_connection_id
                    ) values (%s, %s) returning id
                    """,
                    (request_id, row["calendar_connection_id"]),
                )
                run = await cursor.fetchone()
                if run is None:
                    raise RuntimeError("calendar sync run insert returned no row")
        return (
            CalendarConnection(
                id=row["calendar_connection_id"],
                owner_id=row["owner_id"],
                provider=CalendarProviderName(row["provider"]),
                selected_calendar_id=row["selected_calendar_id"],
                encrypted_refresh_token=row["encrypted_refresh_token"],
                attempt_count=row["attempt_count"] + 1,
                max_attempts=row["max_attempts"],
            ),
            run["id"],
        )

    async def list_items(self, calendar_connection_id: UUID) -> list[CalendarSyncItem]:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select
                  ci.*, c.canonical_name as company_name, j.title as job_title,
                  j.application_url, rd.date_certainty, rd.source_url,
                  ce.id as mapping_id, ce.external_calendar_id, ce.external_event_id,
                  ce.last_synced_hash, ce.sync_status as mapping_sync_status,
                  (
                    ci.deleted_at is null and ci.status <> 'CANCELLED' and ci.sync_enabled and
                    case
                      when ci.type = 'CAREER_EVENT' then cc.sync_career_events
                      when ci.source = 'RECRUITING_INTELLIGENCE' then cc.sync_recruiting_dates
                      when ci.type = 'LEETCODE' then cc.sync_leetcode
                      when ci.type in ('INTERVIEW_PREP', 'SYSTEM_DESIGN', 'BEHAVIORAL_PREP', 'OA')
                        then cc.sync_interview_prep
                      else cc.sync_application_tasks
                    end
                  ) as should_sync
                from public.calendar_connections cc
                join public.calendar_items ci on ci.owner_id = cc.owner_id
                left join public.companies c on c.id = ci.company_id
                left join public.jobs j on j.id = ci.job_id
                left join public.recruiting_dates rd on rd.id = ci.recruiting_date_id
                left join public.calendar_external_events ce
                  on ce.calendar_item_id = ci.id and ce.calendar_connection_id = cc.id
                where cc.id = %s
                  and (ci.sync_enabled or ce.id is not null)
                order by ci.updated_at, ci.id
                """,
                (calendar_connection_id,),
            )
            rows = await cursor.fetchall()
        items: list[CalendarSyncItem] = []
        for row in rows:
            mapping = (
                ExternalEventMapping(
                    id=row["mapping_id"],
                    external_calendar_id=row["external_calendar_id"],
                    external_event_id=row["external_event_id"],
                    last_synced_hash=row["last_synced_hash"],
                    sync_status=ExternalSyncStatus(row["mapping_sync_status"]),
                )
                if row["mapping_id"]
                else None
            )
            starts_on = row["starts_on"]
            ends_on = row["ends_on"]
            items.append(
                CalendarSyncItem(
                    id=row["id"],
                    type=row["type"],
                    title=row["title"],
                    description=row["description"],
                    starts_at=row["starts_at"],
                    ends_at=row["ends_at"],
                    starts_on=(starts_on.isoformat() if isinstance(starts_on, date) else starts_on),
                    ends_on=(ends_on.isoformat() if isinstance(ends_on, date) else ends_on),
                    all_day=row["all_day"],
                    timezone=row["timezone"],
                    status=row["status"],
                    source=row["source"],
                    sync_enabled=row["sync_enabled"],
                    deleted_at=row["deleted_at"],
                    company_name=row["company_name"],
                    job_title=row["job_title"],
                    application_url=row["application_url"],
                    date_certainty=row["date_certainty"],
                    source_url=row["source_url"],
                    metadata=row["metadata"],
                    mapping=mapping,
                    should_sync=row["should_sync"],
                )
            )
        return items

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
        async with await self._connect() as connection:
            await connection.execute(
                """
                insert into public.calendar_external_events (
                  calendar_item_id, calendar_connection_id, provider,
                  external_calendar_id, external_event_id, last_synced_hash,
                  last_synced_at, sync_status, provider_metadata, last_error_code
                ) values (%s, %s, 'GOOGLE', %s, %s, %s, now(), 'SYNCED', %s, null)
                on conflict (calendar_item_id, calendar_connection_id) do update set
                  external_calendar_id = excluded.external_calendar_id,
                  external_event_id = excluded.external_event_id,
                  last_synced_hash = excluded.last_synced_hash,
                  last_synced_at = excluded.last_synced_at,
                  sync_status = 'SYNCED',
                  provider_metadata = excluded.provider_metadata,
                  last_error_code = null
                """,
                (
                    item_id,
                    connection_id,
                    calendar_id,
                    external_event_id,
                    content_hash,
                    Jsonb(metadata or {}),
                ),
            )

    async def mark_mapping(
        self,
        mapping_id: UUID,
        status: ExternalSyncStatus,
        *,
        content_hash: str | None = None,
        error_code: str | None = None,
    ) -> None:
        async with await self._connect() as connection:
            await connection.execute(
                """
                update public.calendar_external_events set sync_status = %s,
                  last_synced_hash = coalesce(%s, last_synced_hash),
                  last_synced_at = case when %s = 'ERROR' then last_synced_at else now() end,
                  last_error_code = %s
                where id = %s
                """,
                (status.value, content_hash, status.value, error_code, mapping_id),
            )

    async def complete(self, stats: CalendarSyncStats) -> None:
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    update public.calendar_sync_runs set status = 'SUCCEEDED',
                      attempted_items = %s, created_events = %s, updated_events = %s,
                      deleted_events = %s, unchanged_events = %s, failed_events = %s,
                      duration_ms = %s, errors = %s, finished_at = now()
                    where id = %s
                    """,
                    (
                        stats.attempted_items,
                        stats.created,
                        stats.updated,
                        stats.deleted,
                        stats.unchanged,
                        stats.failed,
                        stats.duration_ms,
                        Jsonb(stats.errors),
                        stats.run_id,
                    ),
                )
                await connection.execute(
                    """
                    update public.calendar_sync_requests set status = 'SUCCEEDED',
                      finished_at = now(), error_code = null
                    where id = %s
                    """,
                    (stats.request_id,),
                )
                await connection.execute(
                    """
                    update public.calendar_connections c set last_sync_at = now(),
                      last_sync_status = case when %s > 0
                        then 'SYNCED'::public.calendar_sync_status
                        else 'UNCHANGED'::public.calendar_sync_status end,
                      last_error_code = null
                    from public.calendar_sync_requests r
                    where r.id = %s and c.id = r.calendar_connection_id
                    """,
                    (stats.created + stats.updated + stats.deleted, stats.request_id),
                )

    async def fail(
        self,
        stats: CalendarSyncStats,
        *,
        error_code: str,
        reconnect_required: bool,
        retryable: bool,
        attempt_count: int,
        max_attempts: int,
    ) -> None:
        should_retry = retryable and not reconnect_required and attempt_count < max_attempts
        async with await self._connect() as connection:
            async with connection.transaction():
                await connection.execute(
                    """
                    update public.calendar_sync_runs set status = 'FAILED',
                      attempted_items = %s, created_events = %s, updated_events = %s,
                      deleted_events = %s, unchanged_events = %s, failed_events = %s,
                      duration_ms = %s, errors = %s, finished_at = now()
                    where id = %s
                    """,
                    (
                        stats.attempted_items,
                        stats.created,
                        stats.updated,
                        stats.deleted,
                        stats.unchanged,
                        stats.failed,
                        stats.duration_ms,
                        Jsonb(stats.errors),
                        stats.run_id,
                    ),
                )
                if should_retry:
                    await connection.execute(
                        """
                        update public.calendar_sync_requests set status = 'PENDING',
                          started_at = null, finished_at = null, error_code = %s,
                          next_attempt_at = %s
                        where id = %s
                        """,
                        (
                            error_code,
                            datetime.now(UTC)
                            + timedelta(seconds=min(30 * (2**attempt_count), 3600)),
                            stats.request_id,
                        ),
                    )
                else:
                    await connection.execute(
                        """
                        update public.calendar_sync_requests set status = 'FAILED',
                          finished_at = now(), error_code = %s where id = %s
                        """,
                        (error_code, stats.request_id),
                    )
                await connection.execute(
                    """
                    update public.calendar_connections c set
                      connection_status = case when %s then 'REAUTH_REQUIRED'
                                               when not %s and c.connection_status = 'CONNECTED'
                                                 then 'ERROR'
                                               else c.connection_status end,
                      last_sync_status = 'ERROR', last_error_code = %s
                    from public.calendar_sync_requests r
                    where r.id = %s and c.id = r.calendar_connection_id
                    """,
                    (reconnect_required, should_retry, error_code, stats.request_id),
                )
