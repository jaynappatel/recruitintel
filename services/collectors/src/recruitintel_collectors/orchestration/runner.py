import asyncio
import logging

from .dispatcher import TypedWorkDispatcher
from .enums import WorkClass
from .repository import PostgresOrchestrationRepository

logger = logging.getLogger(__name__)


async def run_worker(
    *,
    repository: PostgresOrchestrationRepository,
    dispatcher: TypedWorkDispatcher,
    worker_instance: str,
    classes: tuple[WorkClass, ...],
    batch_size: int,
    lease_seconds: int,
    poll_seconds: float,
    once: bool,
) -> int:
    processed = 0
    while True:
        claimed = await repository.claim(
            worker=worker_instance,
            classes=classes,
            limit=batch_size,
            lease_seconds=lease_seconds,
        )
        if claimed:
            await asyncio.gather(*(dispatcher.execute(work) for work in claimed))
            processed += len(claimed)
        if once:
            return processed
        if not claimed:
            await asyncio.sleep(poll_seconds)


async def run_scheduler(
    *,
    repository: PostgresOrchestrationRepository,
    poll_seconds: float,
    once: bool,
) -> int:
    enqueued = 0
    while True:
        await repository.reap()
        enqueued += await repository.tick_schedules()
        if once:
            return enqueued
        await asyncio.sleep(poll_seconds)
