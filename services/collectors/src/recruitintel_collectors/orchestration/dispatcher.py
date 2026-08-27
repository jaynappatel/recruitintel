import asyncio
import logging
from collections.abc import Awaitable, Callable, Mapping
from typing import Protocol

from recruitintel_collectors.redaction import redact_text

from .enums import FailureClassification, WorkType
from .failures import classify_failure
from .models import ClaimedWork, WorkExecutionResult, WorkFailure
from .repository import PostgresOrchestrationRepository, SourcePolicyBlockedError

logger = logging.getLogger(__name__)


class WorkHandler(Protocol):
    async def __call__(self, work: ClaimedWork) -> WorkExecutionResult: ...


_HEARTBEAT_TYPES = frozenset(
    {
        WorkType.ATS_COLLECT,
        WorkType.GITHUB_SYNC,
        WorkType.PUBLIC_WEB_SEARCH,
        WorkType.CALENDAR_SYNC,
        WorkType.RESUME_PARSE,
        WorkType.MATCH_MATERIALIZE,
    }
)


class TypedWorkDispatcher:
    def __init__(
        self,
        *,
        repository: PostgresOrchestrationRepository,
        handlers: Mapping[WorkType, WorkHandler],
        lease_seconds: int = 300,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        missing = set(WorkType) - set(handlers)
        if missing:
            raise ValueError(f"missing handlers for {sorted(item.value for item in missing)}")
        self._repository = repository
        self._handlers = dict(handlers)
        self._lease_seconds = lease_seconds
        self._sleep = sleep

    async def execute(self, work: ClaimedWork) -> None:
        await self._repository.start(work)
        try:
            await self._repository.assert_source_policy(work.source_id)
            result = await self._execute_handler(work)
            await self._repository.finish_success(work, result)
        except SourcePolicyBlockedError:
            failure = WorkFailure(
                classification=FailureClassification.POLICY_BLOCKED,
                code="SOURCE_POLICY_BLOCKED",
            )
            await self._repository.finish_failure(work, failure)
        except Exception as error:
            failure = classify_failure(error)
            await self._repository.finish_failure(work, failure)
            logger.warning(
                "work_attempt_failed",
                extra={
                    "work_item_id": str(work.id),
                    "work_type": work.work_type.value,
                    "correlation_id": str(work.correlation_id),
                    "classification": failure.classification.value,
                    "error_code": failure.code,
                    "safe_error": redact_text(str(error)),
                },
            )

    async def _execute_handler(self, work: ClaimedWork) -> WorkExecutionResult:
        if work.work_type not in _HEARTBEAT_TYPES:
            return await self._handlers[work.work_type](work)

        handler = asyncio.create_task(self._handlers[work.work_type](work))
        heartbeat = asyncio.create_task(self._heartbeat(work))
        done, _ = await asyncio.wait({handler, heartbeat}, return_when=asyncio.FIRST_COMPLETED)
        if handler in done:
            heartbeat.cancel()
            await asyncio.gather(heartbeat, return_exceptions=True)
            return await handler

        # Losing the fenced lease means this worker must stop producing side effects.
        handler.cancel()
        await asyncio.gather(handler, return_exceptions=True)
        await heartbeat
        raise RuntimeError("heartbeat stopped without reporting a lease failure")

    async def _heartbeat(self, work: ClaimedWork) -> None:
        while True:
            await self._sleep(max(10, self._lease_seconds / 3))
            await self._repository.heartbeat(work, self._lease_seconds)
