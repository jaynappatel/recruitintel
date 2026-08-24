import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, create_autospec
from uuid import uuid4

import pytest
from recruitintel_collectors.orchestration.dispatcher import TypedWorkDispatcher
from recruitintel_collectors.orchestration.enums import (
    FailureClassification,
    WorkClass,
    WorkType,
)
from recruitintel_collectors.orchestration.models import ClaimedWork, WorkExecutionResult
from recruitintel_collectors.orchestration.repository import (
    PostgresOrchestrationRepository,
    SourcePolicyBlockedError,
)


def claimed(work_type: WorkType) -> ClaimedWork:
    return ClaimedWork(
        id=uuid4(),
        attempt_id=uuid4(),
        work_type=work_type,
        work_class=WorkClass.CALENDAR if work_type is WorkType.CALENDAR_SYNC else WorkClass.CONTROL,
        lease_token=uuid4(),
        lease_generation=1,
        lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
        attempt_count=1,
        max_attempts=3,
        correlation_id=uuid4(),
    )


def handlers(default: AsyncMock) -> dict[WorkType, AsyncMock]:
    return {work_type: default for work_type in WorkType}


def repository_mock() -> PostgresOrchestrationRepository:
    return create_autospec(PostgresOrchestrationRepository, instance=True)


@pytest.mark.asyncio
async def test_dispatcher_records_success_for_typed_handler() -> None:
    repository = repository_mock()
    handler = AsyncMock(return_value=WorkExecutionResult(processed=2))
    dispatcher = TypedWorkDispatcher(repository=repository, handlers=handlers(handler))
    work = claimed(WorkType.PRIVACY_RETENTION_CLEANUP)

    await dispatcher.execute(work)

    repository.start.assert_awaited_once_with(work)
    repository.assert_source_policy.assert_awaited_once_with(None)
    handler.assert_awaited_once_with(work)
    repository.finish_success.assert_awaited_once()
    repository.finish_failure.assert_not_awaited()


@pytest.mark.asyncio
async def test_dispatcher_fails_closed_before_handler_when_policy_changes() -> None:
    repository = repository_mock()
    repository.assert_source_policy.side_effect = SourcePolicyBlockedError
    handler = AsyncMock(return_value=WorkExecutionResult())
    dispatcher = TypedWorkDispatcher(repository=repository, handlers=handlers(handler))
    work = claimed(WorkType.ATS_COLLECT)
    work = work.model_copy(update={"source_id": uuid4()})

    await dispatcher.execute(work)

    handler.assert_not_awaited()
    failure = repository.finish_failure.await_args.args[1]
    assert failure.classification is FailureClassification.POLICY_BLOCKED
    assert failure.code == "SOURCE_POLICY_BLOCKED"


@pytest.mark.asyncio
async def test_heartbeat_failure_cancels_long_running_handler() -> None:
    repository = repository_mock()
    repository.heartbeat.side_effect = RuntimeError("fenced lease lost")
    cancelled = asyncio.Event()
    started = asyncio.Event()

    async def long_handler(work: ClaimedWork) -> WorkExecutionResult:
        del work
        try:
            started.set()
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    dispatcher = TypedWorkDispatcher(
        repository=repository,
        handlers={work_type: long_handler for work_type in WorkType},
        lease_seconds=1,
        sleep=started.wait,
    )
    work = claimed(WorkType.CALENDAR_SYNC)

    await dispatcher.execute(work)

    assert cancelled.is_set()
    failure = repository.finish_failure.await_args.args[1]
    assert failure.classification is FailureClassification.RETRYABLE
    assert failure.code == "UNEXPECTED_WORK_FAILURE"
