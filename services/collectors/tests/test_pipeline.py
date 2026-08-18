from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
from recruitintel_collectors.adapters.base import BaseCollector, CollectorError
from recruitintel_collectors.domain.enums import (
    CollectorStage,
    EmploymentType,
    ExperienceLevel,
    RecruitingEventType,
    RoleFamily,
)
from recruitintel_collectors.domain.fingerprints import fingerprint_job
from recruitintel_collectors.domain.models import (
    CollectorResult,
    FingerprintedJob,
    NormalizedJob,
    SourceConfig,
)
from recruitintel_collectors.pipeline.memory import InMemoryRepository
from recruitintel_collectors.pipeline.runner import CollectorRunner


def _clock() -> Iterator[datetime]:
    value = datetime(2026, 8, 17, 12, tzinfo=UTC)
    while True:
        yield value
        value += timedelta(minutes=1)


def _job(
    *, title: str = "Software Engineer Intern", location: str = "Austin, TX"
) -> FingerprintedJob:
    job = NormalizedJob(
        external_id="provider-job-1",
        title=title,
        description="Build reliable systems.",
        location=location,
        employment_type=EmploymentType.INTERNSHIP,
        role_family=RoleFamily.SOFTWARE_ENGINEERING,
        experience_level=ExperienceLevel.INTERNSHIP,
        is_internship=True,
        is_new_grad=False,
        season="SUMMER",
        graduation_years=(2027,),
        application_url="https://jobs.example.com/1/apply",
        source_url="https://jobs.example.com/1",
        published_at=datetime(2026, 8, 15, tzinfo=UTC),
        raw_payload={"id": "provider-job-1", "title": title, "location": location},
    )
    return FingerprintedJob(job=job, content_hash=fingerprint_job(job))


def _result(
    source: SourceConfig, *jobs: FingerprintedJob, complete: bool = True
) -> CollectorResult:
    return CollectorResult(
        provider=source.provider,
        source_id=source.id,
        jobs=jobs,
        discovered=len(jobs),
        complete=complete,
    )


class _FakeCollector:
    provider = "greenhouse"

    def __init__(self, result: CollectorResult) -> None:
        self.result = result

    async def collect(self, source: SourceConfig) -> CollectorResult:
        assert source.id == self.result.source_id
        return self.result


def _runner(
    source: SourceConfig,
    repository: InMemoryRepository,
    collector: _FakeCollector,
) -> CollectorRunner:
    return CollectorRunner(
        repository=repository,
        registry={"greenhouse": cast(BaseCollector, collector)},
    )


@pytest.mark.asyncio
async def test_job_lifecycle_open_unchanged_change_close_and_reopen(source: SourceConfig) -> None:
    clock = _clock()
    repository = InMemoryRepository((source,), now=lambda: next(clock))
    collector = _FakeCollector(_result(source, _job()))
    runner = _runner(source, repository, collector)

    opened = await runner.run(source.id)
    assert opened.new == 1
    assert opened.changed == opened.unchanged == opened.closed == 0
    assert len(repository.jobs) == 1
    assert len(repository.events) == 1

    unchanged = await runner.run(source.id)
    assert unchanged.unchanged == 1
    assert len(repository.events) == 1
    assert len(repository.snapshots) == 1

    collector.result = _result(source, _job(location="Chicago, IL"))
    changed = await runner.run(source.id)
    assert changed.changed == 1
    assert len(repository.events) == 2
    assert len(repository.snapshots) == 2

    collector.result = _result(source)
    closed = await runner.run(source.id)
    assert closed.closed == 1
    assert next(iter(repository.jobs.values())).closed_at is not None

    collector.result = _result(source, _job(location="Chicago, IL"))
    reopened = await runner.run(source.id)
    assert reopened.new == 1
    assert next(iter(repository.jobs.values())).closed_at is None
    assert [event.event_type for event in repository.events] == [
        RecruitingEventType.JOB_OPENED,
        RecruitingEventType.JOB_CHANGED,
        RecruitingEventType.JOB_CLOSED,
        RecruitingEventType.JOB_OPENED,
    ]
    assert len(repository.event_fingerprints) == len(repository.events)


@pytest.mark.asyncio
async def test_incomplete_sync_never_closes_existing_jobs(source: SourceConfig) -> None:
    clock = _clock()
    repository = InMemoryRepository((source,), now=lambda: next(clock))
    collector = _FakeCollector(_result(source, _job()))
    runner = _runner(source, repository, collector)
    await runner.run(source.id)

    collector.result = _result(source, complete=False)
    with pytest.raises(CollectorError) as error:
        await runner.run(source.id)
    assert error.value.stage is CollectorStage.FETCH
    stored = next(iter(repository.jobs.values()))
    assert stored.closed_at is None
    assert len(repository.events) == 1
    assert list(repository.runs.values())[-1]["status"] == "FAILED"
    assert repository.errors[-1]["stage"] == "FETCH"


@pytest.mark.asyncio
async def test_duplicate_external_ids_fail_before_any_mutation(source: SourceConfig) -> None:
    clock = _clock()
    repository = InMemoryRepository((source,), now=lambda: next(clock))
    duplicate = _job(location="Chicago, IL")
    collector = _FakeCollector(_result(source, _job(), duplicate))
    runner = _runner(source, repository, collector)

    with pytest.raises(ValueError, match="duplicate external IDs"):
        await runner.run(source.id)
    assert repository.jobs == {}
    assert repository.events == []
    assert list(repository.runs.values())[-1]["status"] == "FAILED"


@pytest.mark.asyncio
async def test_collector_failure_records_error_without_silently_succeeding(
    source: SourceConfig,
) -> None:
    class FailingCollector(_FakeCollector):
        async def collect(self, source: SourceConfig) -> CollectorResult:
            raise CollectorError(
                "provider is unavailable",
                stage=CollectorStage.FETCH,
                retryable=True,
                context={"provider": source.provider},
            )

    clock = _clock()
    repository = InMemoryRepository((source,), now=lambda: next(clock))
    collector = FailingCollector(_result(source))
    runner = _runner(source, repository, collector)

    with pytest.raises(CollectorError, match="provider is unavailable"):
        await runner.run(source.id)
    assert repository.errors[-1]["retryable"] is True
    assert list(repository.runs.values())[-1]["status"] == "FAILED"
