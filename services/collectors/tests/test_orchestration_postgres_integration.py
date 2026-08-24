import os
from typing import cast
from uuid import UUID

import psycopg
import pytest
from psycopg.rows import dict_row
from recruitintel_collectors.adapters.base import BaseCollector
from recruitintel_collectors.domain.enums import EmploymentType, ExperienceLevel, RoleFamily
from recruitintel_collectors.domain.fingerprints import fingerprint_job
from recruitintel_collectors.domain.models import (
    CollectorResult,
    FingerprintedJob,
    NormalizedJob,
    SourceConfig,
)
from recruitintel_collectors.infrastructure.postgres import PostgresCollectorRepository
from recruitintel_collectors.orchestration.dispatcher import TypedWorkDispatcher
from recruitintel_collectors.orchestration.enums import CoverageStatus, WorkClass, WorkType
from recruitintel_collectors.orchestration.models import ClaimedWork, WorkExecutionResult
from recruitintel_collectors.orchestration.repository import PostgresOrchestrationRepository
from recruitintel_collectors.pipeline import CollectorRunner

COMPANY_ID = UUID("97600000-0000-0000-0000-000000000001")
SOURCE_ID = UUID("97600000-0000-0000-0000-000000000002")
POLICY_ID = UUID("97600000-0000-0000-0000-000000000003")
SCHEDULE_ID = UUID("97600000-0000-0000-0000-000000000004")
PRINCIPAL_ID = UUID("97600000-0000-0000-0000-000000000005")


def database_url() -> str:
    value = os.getenv("TEST_DATABASE_URL")
    if not value:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL integration tests")
    return value


def result() -> CollectorResult:
    job = NormalizedJob(
        external_id="scheduled-job",
        title="Scheduled Software Engineering Intern",
        description="Deterministic orchestration fixture.",
        location="Austin, TX",
        employment_type=EmploymentType.INTERNSHIP,
        role_family=RoleFamily.SOFTWARE_ENGINEERING,
        experience_level=ExperienceLevel.INTERNSHIP,
        is_internship=True,
        is_new_grad=False,
        application_url="https://jobs.example.com/scheduled-job/apply",
        source_url="https://jobs.example.com/scheduled-job",
        raw_payload={"fixture": True},
    )
    return CollectorResult(
        provider="orchestration_test",
        source_id=SOURCE_ID,
        jobs=(FingerprintedJob(job=job, content_hash=fingerprint_job(job)),),
        discovered=1,
        complete=True,
    )


class FixtureCollector:
    provider = "orchestration_test"

    async def collect(self, source: SourceConfig) -> CollectorResult:
        assert source.id == SOURCE_ID
        return result()


async def reset(url: str) -> None:
    async with await psycopg.AsyncConnection.connect(url) as connection:
        await connection.execute("delete from public.companies where id = %s", (COMPANY_ID,))
        await connection.execute("delete from public.source_policies where id = %s", (POLICY_ID,))
        await connection.execute(
            "delete from public.service_principals where id = %s", (PRINCIPAL_ID,)
        )


@pytest.mark.integration
@pytest.mark.asyncio
async def test_scheduled_ats_work_runs_through_dispatcher_and_advances_schedule() -> None:
    url = database_url()
    await reset(url)
    async with await psycopg.AsyncConnection.connect(url, row_factory=dict_row) as connection:
        await connection.execute(
            """
            insert into public.source_policies (
              id, provider, display_name, status, collection_method,
              official_api_available, robots_policy, terms_status,
              reviewed_at, reviewed_by
            ) values (
              %s, 'orchestration_test', 'Orchestration integration fixture',
              'ALLOWED_WITH_LIMITS', 'OFFICIAL_API', true, 'NOT_APPLICABLE',
              'REVIEWED', now(), 'integration-test'
            )
            """,
            (POLICY_ID,),
        )
        await connection.execute(
            "insert into public.companies (id, canonical_name, slug) values (%s, %s, %s)",
            (COMPANY_ID, "Orchestration Test Company", "orchestration-test-company"),
        )
        await connection.execute(
            """
            insert into public.sources (
              id, company_id, source_type, provider, external_key, name,
              reliability, enabled, source_policy_id
            ) values (%s, %s, 'ATS', 'orchestration_test', 'scheduled-fixture',
              'Scheduled fixture', 1.0, true, %s)
            """,
            (SOURCE_ID, COMPANY_ID, POLICY_ID),
        )
        await connection.execute(
            """
            insert into public.service_principals (
              id, name, kind, token_prefix, token_hash, scopes, status
            ) values (
              %s, 'Orchestration integration worker', 'WORKER',
              'ri_worker_OrchTest01', encode(digest('orchestration-test-worker', 'sha256'), 'hex'),
              array['WORKER_INGEST', 'WORKER_GLOBAL', 'WORKER_SCHEDULER']::public.service_scope[],
              'ACTIVE'
            )
            """,
            (PRINCIPAL_ID,),
        )
        await connection.execute(
            """
            insert into public.worker_role_bindings (
              database_role, service_principal_id, allowed_work_classes, can_schedule
            ) values (
              current_user, %s, array['ATS']::public.work_class[], true
            ) on conflict (database_role) do update set
              service_principal_id = excluded.service_principal_id,
              allowed_work_classes = excluded.allowed_work_classes,
              can_schedule = excluded.can_schedule
            """,
            (PRINCIPAL_ID,),
        )
        await connection.execute(
            """
            insert into public.schedules (
              id, name, work_type, work_class, source_id, enabled, schedule_kind,
              interval_seconds, anchor_at, next_run_at, jitter_seconds
            ) values (
              %s, 'integration:scheduled-ats', 'ATS_COLLECT', 'ATS', %s, true,
              'INTERVAL', 3600, now() - interval '1 hour', now() - interval '1 minute', 0
            )
            """,
            (SCHEDULE_ID, SOURCE_ID),
        )

    orchestration = PostgresOrchestrationRepository(url)
    assert await orchestration.tick_schedules() == 1
    claimed = await orchestration.claim(
        worker="orchestration-integration",
        classes=(WorkClass.ATS,),
        limit=1,
        lease_seconds=300,
    )
    assert len(claimed) == 1

    async def collect(work: ClaimedWork) -> WorkExecutionResult:
        repository = PostgresCollectorRepository(url, work_attempt_id=work.attempt_id)
        stats = await CollectorRunner(
            repository=repository,
            registry={"orchestration_test": cast(BaseCollector, FixtureCollector())},
        ).run(SOURCE_ID)
        return WorkExecutionResult(
            coverage=CoverageStatus.COMPLETE,
            discovered=stats.discovered,
            processed=stats.new + stats.changed + stats.unchanged,
        )

    dispatcher = TypedWorkDispatcher(
        repository=orchestration,
        handlers={work_type: collect for work_type in WorkType},
    )
    try:
        await dispatcher.execute(claimed[0])
        async with await psycopg.AsyncConnection.connect(url, row_factory=dict_row) as connection:
            cursor = await connection.execute(
                """
                select work.status::text, work.attempt_count,
                  attempt.status::text as attempt_status,
                  collector.status::text as collector_status,
                  collector.work_attempt_id,
                  schedule.last_enqueued_for,
                  schedule.next_run_at > schedule.last_enqueued_for as advanced,
                  (select count(*)::int from public.jobs where source_id = %s) as jobs
                from public.work_items work
                join public.work_attempts attempt on attempt.work_item_id = work.id
                join public.collector_runs collector on collector.work_attempt_id = attempt.id
                join public.schedules schedule on schedule.id = work.schedule_id
                where work.id = %s
                """,
                (SOURCE_ID, claimed[0].id),
            )
            row = await cursor.fetchone()
            assert row is not None
            assert row["status"] == "SUCCEEDED"
            assert row["attempt_count"] == 1
            assert row["attempt_status"] == "SUCCEEDED"
            assert row["collector_status"] == "SUCCEEDED"
            assert row["work_attempt_id"] == claimed[0].attempt_id
            assert row["last_enqueued_for"] is not None
            assert row["advanced"] is True
            assert row["jobs"] == 1
    finally:
        await reset(url)
