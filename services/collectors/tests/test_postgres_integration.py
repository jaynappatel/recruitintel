import os
from datetime import UTC, datetime
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row
from recruitintel_collectors.domain.enums import (
    EmploymentType,
    ExperienceLevel,
    RoleFamily,
)
from recruitintel_collectors.domain.fingerprints import fingerprint_job, fingerprint_job_derivation
from recruitintel_collectors.domain.models import (
    CollectorResult,
    FingerprintedJob,
    NormalizedJob,
    SourceConfig,
)
from recruitintel_collectors.infrastructure.postgres import PostgresCollectorRepository

COMPANY_ID = UUID("91000000-0000-0000-0000-000000000001")
SOURCE_ID = UUID("92000000-0000-0000-0000-000000000001")


def _database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


def _job(location: str = "Austin, TX") -> FingerprintedJob:
    job = NormalizedJob(
        external_id="integration-job-1",
        title="Software Engineering Intern",
        description="Build reliable systems.",
        location=location,
        employment_type=EmploymentType.INTERNSHIP,
        role_family=RoleFamily.SOFTWARE_ENGINEERING,
        experience_level=ExperienceLevel.INTERNSHIP,
        is_internship=True,
        is_new_grad=False,
        season="SUMMER",
        graduation_years=(2027,),
        application_url="https://jobs.example.com/integration-job-1/apply",
        source_url="https://jobs.example.com/integration-job-1",
        published_at=datetime(2026, 8, 15, tzinfo=UTC),
        raw_payload={"id": "integration-job-1", "location": location},
    )
    return FingerprintedJob(job=job, content_hash=fingerprint_job(job))


def _result(*jobs: FingerprintedJob) -> CollectorResult:
    return CollectorResult(
        provider="greenhouse",
        source_id=SOURCE_ID,
        jobs=jobs,
        discovered=len(jobs),
        complete=True,
    )


async def _reset_fixture(database_url: str) -> None:
    async with await psycopg.AsyncConnection.connect(database_url) as connection:
        await connection.execute("delete from public.companies where id = %s", (COMPANY_ID,))


@pytest.mark.integration
@pytest.mark.asyncio
async def test_postgres_repository_persists_complete_job_lifecycle() -> None:
    database_url = _database_url()
    await _reset_fixture(database_url)
    source = SourceConfig(
        id=SOURCE_ID,
        company_id=COMPANY_ID,
        company_name="Integration Test Company",
        provider="greenhouse",
        external_key="recruitintel-integration-test",
        name="Integration test Greenhouse board",
        reliability=0.98,
    )

    try:
        async with await psycopg.AsyncConnection.connect(database_url) as connection:
            await connection.execute(
                """
                insert into public.companies (id, canonical_name, slug)
                values (%s, %s, %s)
                """,
                (COMPANY_ID, source.company_name, "integration-test-company"),
            )
            await connection.execute(
                """
                insert into public.sources (
                  id, company_id, source_type, provider, external_key, name, reliability
                ) values (%s, %s, 'ATS', %s, %s, %s, %s)
                """,
                (
                    SOURCE_ID,
                    COMPANY_ID,
                    source.provider,
                    source.external_key,
                    source.name,
                    source.reliability,
                ),
            )

        repository = PostgresCollectorRepository(database_url)
        initial = _result(_job())

        run_id = await repository.create_run(source, source.provider)
        opened = await repository.persist_complete_batch(
            run_id=run_id, source=source, result=initial
        )
        assert opened.new == 1

        run_id = await repository.create_run(source, source.provider)
        unchanged = await repository.persist_complete_batch(
            run_id=run_id, source=source, result=initial
        )
        assert unchanged.unchanged == 1

        reclassified_job = initial.jobs[0].job.model_copy(
            update={
                "role_family": RoleFamily.DATA_SCIENCE,
                "classification_version": 2,
                "derivation_version": 2,
            }
        )
        derivation_only = FingerprintedJob(
            job=reclassified_job,
            content_hash=initial.jobs[0].content_hash,
            derivation_hash=fingerprint_job_derivation(reclassified_job),
        )
        run_id = await repository.create_run(source, source.provider)
        recomputed = await repository.persist_complete_batch(
            run_id=run_id, source=source, result=_result(derivation_only)
        )
        assert recomputed.unchanged == 1

        run_id = await repository.create_run(source, source.provider)
        changed = await repository.persist_complete_batch(
            run_id=run_id, source=source, result=_result(_job("Chicago, IL"))
        )
        assert changed.changed == 1

        run_id = await repository.create_run(source, source.provider)
        closed = await repository.persist_complete_batch(
            run_id=run_id, source=source, result=_result()
        )
        assert closed.closed == 1

        run_id = await repository.create_run(source, source.provider)
        reopened = await repository.persist_complete_batch(
            run_id=run_id, source=source, result=_result(_job("Chicago, IL"))
        )
        assert reopened.new == 1

        async with await psycopg.AsyncConnection.connect(
            database_url, row_factory=dict_row
        ) as connection:
            cursor = await connection.execute(
                """
                select
                  (select count(*) from public.jobs where source_id = %s)::int as jobs,
                  (select count(*) from public.job_snapshots js
                    join public.jobs j on j.id = js.job_id
                    where j.source_id = %s)::int as snapshots,
                  (select count(*) from public.observations
                    where source_id = %s)::int as observations,
                  (select count(*) from public.recruiting_events
                    where source_id = %s)::int as events,
                  (select count(*) from public.collector_runs
                    where source_id = %s and status = 'SUCCEEDED')::int as successful_runs,
                  (select count(*) from public.job_derivation_events derivation
                    join public.jobs job on job.id = derivation.job_id
                    where job.source_id = %s
                      and derivation.event_type = 'DERIVATION_RECOMPUTED')::int
                    as derivation_events
                """,
                (SOURCE_ID, SOURCE_ID, SOURCE_ID, SOURCE_ID, SOURCE_ID, SOURCE_ID),
            )
            counts = await cursor.fetchone()
            assert counts == {
                "jobs": 1,
                "snapshots": 2,
                "observations": 3,
                "events": 4,
                "successful_runs": 6,
                "derivation_events": 1,
            }
            events = await connection.execute(
                """
                select event_type::text as event_type
                from public.recruiting_events
                where source_id = %s
                order by discovered_at, created_at
                """,
                (SOURCE_ID,),
            )
            assert [row["event_type"] for row in await events.fetchall()] == [
                "JOB_OPENED",
                "JOB_CHANGED",
                "JOB_CLOSED",
                "JOB_OPENED",
            ]
    finally:
        await _reset_fixture(database_url)
