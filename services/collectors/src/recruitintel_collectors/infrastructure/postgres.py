from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from recruitintel_collectors.domain.enums import (
    CollectorStage,
    JobTransition,
    RecruitingEventType,
)
from recruitintel_collectors.domain.fingerprints import fingerprint_event
from recruitintel_collectors.domain.models import (
    CollectorResult,
    FingerprintedJob,
    SourceConfig,
    SyncStats,
)
from recruitintel_collectors.pipeline.memory import RunAlreadyActiveError
from recruitintel_collectors.pipeline.transitions import (
    decide_job_transition,
    ensure_unique_external_ids,
)
from recruitintel_collectors.redaction import redact_text, redact_value


def _source_from_row(row: dict[str, Any]) -> SourceConfig:
    return SourceConfig(
        id=row["id"],
        company_id=row["company_id"],
        company_name=row["company_name"],
        provider=row["provider"],
        external_key=row["external_key"],
        name=row["name"],
        reliability=float(row["reliability"]),
        enabled=row["enabled"],
        metadata=row["metadata"],
    )


class PostgresCollectorRepository:
    def __init__(self, database_url: str, *, work_attempt_id: UUID | None = None) -> None:
        if not database_url.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must be a PostgreSQL URL")
        self.database_url = database_url
        self.work_attempt_id = work_attempt_id

    async def _connect(self) -> psycopg.AsyncConnection[dict[str, Any]]:
        return await psycopg.AsyncConnection.connect(self.database_url, row_factory=dict_row)

    async def get_source(self, source_id: UUID) -> SourceConfig:
        async with await self._connect() as connection:
            row = await connection.execute(
                """
                select s.id, s.company_id, c.canonical_name as company_name,
                       s.provider, s.external_key, s.name, s.reliability, s.enabled, s.metadata
                from public.sources s
                join public.companies c on c.id = s.company_id
                where s.id = %s
                """,
                (source_id,),
            )
            source = await row.fetchone()
        if source is None:
            raise KeyError(f"source {source_id} was not found")
        config = _source_from_row(source)
        if not config.enabled:
            raise ValueError(f"source {source_id} is disabled")
        return config

    async def list_sources(self) -> tuple[SourceConfig, ...]:
        async with await self._connect() as connection:
            cursor = await connection.execute(
                """
                select s.id, s.company_id, c.canonical_name as company_name,
                       s.provider, s.external_key, s.name, s.reliability, s.enabled, s.metadata
                from public.sources s
                join public.companies c on c.id = s.company_id
                where s.source_type = 'ATS'
                order by c.canonical_name, s.provider, s.external_key
                """
            )
            rows = await cursor.fetchall()
        return tuple(_source_from_row(row) for row in rows)

    async def create_run(self, source: SourceConfig, collector: str) -> UUID:
        try:
            async with await self._connect() as connection:
                cursor = await connection.execute(
                    """
                    insert into public.collector_runs (source_id, collector, work_attempt_id)
                    values (%s, %s, %s)
                    returning id
                    """,
                    (source.id, collector, self.work_attempt_id),
                )
                row = await cursor.fetchone()
                if row is None:
                    raise RuntimeError("collector run insert returned no ID")
                return UUID(str(row["id"]))
        except UniqueViolation as exc:
            raise RunAlreadyActiveError(f"source {source.id} already has an active run") from exc

    @staticmethod
    async def _insert_snapshot_and_observation(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        run_id: UUID,
        source: SourceConfig,
        job_id: UUID,
        value: FingerprintedJob,
        observed_at: datetime,
    ) -> None:
        normalized = value.job.model_dump(mode="json", exclude={"raw_payload"})
        await cursor.execute(
            """
            insert into public.job_snapshots (
              job_id, collector_run_id, content_hash, fingerprint_version,
              normalized_payload, raw_payload, observed_at
            ) values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (job_id, content_hash) do nothing
            """,
            (
                job_id,
                run_id,
                value.content_hash,
                value.job.fingerprint_version,
                Jsonb(normalized),
                Jsonb(value.job.raw_payload),
                observed_at,
            ),
        )
        await cursor.execute(
            """
            insert into public.observations (
              source_id, collector_run_id, entity_type, job_id, source_url,
              collected_at, published_at, raw_text, normalized_text,
              content_hash, confidence, metadata
            ) values (%s, %s, 'JOB', %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                source.id,
                run_id,
                job_id,
                value.job.source_url,
                observed_at,
                value.job.published_at,
                value.job.description,
                "\n".join((value.job.title, value.job.description, value.job.location)),
                value.content_hash,
                source.reliability,
                Jsonb(
                    {
                        "provider": source.provider,
                        "external_id": value.job.external_id,
                        "fingerprint_version": value.job.fingerprint_version,
                    }
                ),
            ),
        )

    @staticmethod
    async def _insert_event(
        cursor: psycopg.AsyncCursor[dict[str, Any]],
        *,
        source: SourceConfig,
        job_id: UUID,
        event_type: RecruitingEventType,
        content_hash: str,
        source_url: str,
        occurred_at: datetime,
        discovered_at: datetime,
        sequence: str,
        payload: dict[str, Any],
    ) -> None:
        fingerprint = fingerprint_event(
            event_type=event_type,
            company_id=source.company_id,
            source_id=source.id,
            job_id=job_id,
            causal_hash=content_hash,
            sequence=sequence,
        )
        await cursor.execute(
            """
            insert into public.recruiting_events (
              company_id, source_id, job_id, event_type, occurred_at, discovered_at,
              source_url, confidence, fingerprint, payload
            ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (fingerprint) do nothing
            """,
            (
                source.company_id,
                source.id,
                job_id,
                event_type.value,
                occurred_at,
                discovered_at,
                source_url,
                source.reliability,
                fingerprint,
                Jsonb(payload),
            ),
        )

    @staticmethod
    def _job_parameters(
        *,
        source: SourceConfig,
        run_id: UUID,
        value: FingerprintedJob,
        now: datetime,
    ) -> tuple[Any, ...]:
        job = value.job
        return (
            source.company_id,
            source.id,
            job.external_id,
            job.title,
            job.description,
            job.location,
            job.employment_type.value,
            job.role_family.value,
            job.experience_level.value,
            job.is_internship,
            job.is_new_grad,
            job.season,
            list(job.graduation_years),
            job.application_url,
            job.source_url,
            now,
            now,
            now,
            job.published_at,
            value.content_hash,
            job.fingerprint_version,
            job.classification_version,
            run_id,
            Jsonb(job.raw_payload),
        )

    async def persist_complete_batch(
        self,
        *,
        run_id: UUID,
        source: SourceConfig,
        result: CollectorResult,
    ) -> SyncStats:
        if not result.complete:
            raise ValueError("an incomplete result cannot be persisted")
        ensure_unique_external_ids([item.job.external_id for item in result.jobs])
        now = datetime.now(UTC)
        counts = {"new": 0, "changed": 0, "unchanged": 0, "closed": 0}

        async with await self._connect() as connection:
            async with connection.transaction():
                cursor = connection.cursor()
                await cursor.execute(
                    "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                    (str(source.id),),
                )
                await cursor.execute(
                    """
                    select id from public.collector_runs
                    where id = %s and source_id = %s and status = 'RUNNING'
                    for update
                    """,
                    (run_id, source.id),
                )
                if await cursor.fetchone() is None:
                    raise ValueError("run is not active for this source")

                for incoming in result.jobs:
                    await cursor.execute(
                        """
                        select id, content_hash, closed_at
                        from public.jobs
                        where source_id = %s and external_id = %s
                        for update
                        """,
                        (source.id, incoming.job.external_id),
                    )
                    existing = await cursor.fetchone()
                    transition = decide_job_transition(
                        existing_hash=existing["content_hash"] if existing else None,
                        existing_closed_at=existing["closed_at"] if existing else None,
                        incoming_hash=incoming.content_hash,
                    )

                    if existing is None:
                        await cursor.execute(
                            """
                            insert into public.jobs (
                              company_id, source_id, external_id, title, description, location,
                              employment_type, role_family, experience_level, is_internship,
                              is_new_grad, season, graduation_years, application_url, source_url,
                              first_seen_at, last_seen_at, changed_at, published_at, content_hash,
                              fingerprint_version, classification_version, last_seen_run_id,
                              raw_payload
                            ) values (
                              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                            ) returning id
                            """,
                            self._job_parameters(
                                source=source, run_id=run_id, value=incoming, now=now
                            ),
                        )
                        inserted = await cursor.fetchone()
                        if inserted is None:
                            raise RuntimeError("job insert returned no ID")
                        job_id = inserted["id"]
                        counts["new"] += 1
                        await self._insert_snapshot_and_observation(
                            cursor,
                            run_id=run_id,
                            source=source,
                            job_id=job_id,
                            value=incoming,
                            observed_at=now,
                        )
                        await self._insert_event(
                            cursor,
                            source=source,
                            job_id=job_id,
                            event_type=RecruitingEventType.JOB_OPENED,
                            content_hash=incoming.content_hash,
                            source_url=incoming.job.source_url,
                            occurred_at=incoming.job.published_at or now,
                            discovered_at=now,
                            sequence="initial",
                            payload={"content_hash": incoming.content_hash, "reopened": False},
                        )
                        continue

                    job_id = existing["id"]
                    previous_hash = existing["content_hash"]
                    previous_closed_at = existing["closed_at"]
                    if transition is JobTransition.UNCHANGED:
                        await cursor.execute(
                            """
                            update public.jobs
                            set last_seen_at = %s, last_seen_run_id = %s
                            where id = %s
                            """,
                            (now, run_id, job_id),
                        )
                        counts["unchanged"] += 1
                        continue

                    job = incoming.job
                    await cursor.execute(
                        """
                        update public.jobs set
                          title = %s, description = %s, location = %s,
                          employment_type = %s, role_family = %s, experience_level = %s,
                          is_internship = %s, is_new_grad = %s, season = %s,
                          graduation_years = %s, application_url = %s, source_url = %s,
                          last_seen_at = %s, changed_at = %s, published_at = %s,
                          closed_at = null, content_hash = %s, fingerprint_version = %s,
                          classification_version = %s, last_seen_run_id = %s, raw_payload = %s
                        where id = %s
                        """,
                        (
                            job.title,
                            job.description,
                            job.location,
                            job.employment_type.value,
                            job.role_family.value,
                            job.experience_level.value,
                            job.is_internship,
                            job.is_new_grad,
                            job.season,
                            list(job.graduation_years),
                            job.application_url,
                            job.source_url,
                            now,
                            now,
                            job.published_at,
                            incoming.content_hash,
                            job.fingerprint_version,
                            job.classification_version,
                            run_id,
                            Jsonb(job.raw_payload),
                            job_id,
                        ),
                    )
                    await self._insert_snapshot_and_observation(
                        cursor,
                        run_id=run_id,
                        source=source,
                        job_id=job_id,
                        value=incoming,
                        observed_at=now,
                    )
                    if transition is JobTransition.REOPENED:
                        counts["new"] += 1
                        await self._insert_event(
                            cursor,
                            source=source,
                            job_id=job_id,
                            event_type=RecruitingEventType.JOB_OPENED,
                            content_hash=incoming.content_hash,
                            source_url=job.source_url,
                            occurred_at=now,
                            discovered_at=now,
                            sequence=f"reopen:{previous_closed_at.isoformat()}",
                            payload={
                                "content_hash": incoming.content_hash,
                                "previous_content_hash": previous_hash,
                                "reopened": True,
                            },
                        )
                    else:
                        counts["changed"] += 1
                        await self._insert_event(
                            cursor,
                            source=source,
                            job_id=job_id,
                            event_type=RecruitingEventType.JOB_CHANGED,
                            content_hash=incoming.content_hash,
                            source_url=job.source_url,
                            occurred_at=now,
                            discovered_at=now,
                            sequence=incoming.content_hash,
                            payload={
                                "content_hash": incoming.content_hash,
                                "previous_content_hash": previous_hash,
                            },
                        )

                await cursor.execute(
                    """
                    select id, content_hash, source_url
                    from public.jobs
                    where source_id = %s and closed_at is null
                      and last_seen_run_id is distinct from %s
                    for update
                    """,
                    (source.id, run_id),
                )
                absent = await cursor.fetchall()
                for row in absent:
                    await cursor.execute(
                        "update public.jobs set closed_at = %s, changed_at = %s where id = %s",
                        (now, now, row["id"]),
                    )
                    counts["closed"] += 1
                    await self._insert_event(
                        cursor,
                        source=source,
                        job_id=row["id"],
                        event_type=RecruitingEventType.JOB_CLOSED,
                        content_hash=row["content_hash"],
                        source_url=row["source_url"],
                        occurred_at=now,
                        discovered_at=now,
                        sequence=f"absent:{run_id}",
                        payload={"content_hash": row["content_hash"], "reason": "source_absent"},
                    )

                stats = SyncStats(discovered=result.discovered, **counts)
                await cursor.execute(
                    """
                    update public.collector_runs set
                      status = 'SUCCEEDED', finished_at = %s, items_discovered = %s,
                      items_new = %s, items_changed = %s, items_unchanged = %s,
                      items_closed = %s
                    where id = %s
                    """,
                    (
                        now,
                        stats.discovered,
                        stats.new,
                        stats.changed,
                        stats.unchanged,
                        stats.closed,
                        run_id,
                    ),
                )
                return stats

    async def record_error(
        self,
        *,
        run_id: UUID,
        stage: CollectorStage,
        error_type: str,
        message: str,
        retryable: bool,
        context: dict[str, Any],
    ) -> None:
        async with await self._connect() as connection:
            await connection.execute(
                """
                insert into public.collector_errors (
                  collector_run_id, stage, error_type, message, retryable, context
                ) values (%s, %s, %s, %s, %s, %s)
                """,
                (
                    run_id,
                    stage.value,
                    error_type,
                    redact_text(message)[:10_000],
                    retryable,
                    Jsonb(redact_value(context)),
                ),
            )

    async def fail_run(self, run_id: UUID, *, discovered: int, errors: int = 1) -> None:
        async with await self._connect() as connection:
            await connection.execute(
                """
                update public.collector_runs set
                  status = 'FAILED', finished_at = now(), items_discovered = %s, errors = %s
                where id = %s and status = 'RUNNING'
                """,
                (discovered, errors, run_id),
            )
