import argparse
import asyncio
import json
import os
import socket
from collections.abc import Sequence
from uuid import UUID

from recruitintel_collectors.config import Settings
from recruitintel_collectors.infrastructure.postgres import PostgresCollectorRepository
from recruitintel_collectors.logging import configure_logging
from recruitintel_collectors.orchestration import (
    PostgresOrchestrationRepository,
    TypedWorkDispatcher,
    WorkClass,
)
from recruitintel_collectors.orchestration.handlers import RuntimeWorkHandlers
from recruitintel_collectors.orchestration.runner import run_scheduler, run_worker

_DEFAULT_WORKER_CLASSES = (
    WorkClass.ATS,
    WorkClass.GITHUB,
    WorkClass.WEB_SEARCH,
    WorkClass.WEB_FETCH,
    WorkClass.PROJECTION,
    WorkClass.CONTROL,
    WorkClass.RESUME,
)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="recruitintel-collectors",
        description="Run finite, observable RecruitIntel source collectors.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    run = subcommands.add_parser("run", help="Run one configured ATS source")
    run.add_argument("--source-id", type=UUID, required=True)
    github_sync = subcommands.add_parser(
        "github-sync", help="Run one configured GitHub repository sync"
    )
    github_sync.add_argument("--repository-id", type=UUID, required=True)
    github_sync.add_argument("--request-id", type=UUID)
    public_web = subcommands.add_parser(
        "public-web-work", help="Run one durable public-web work request"
    )
    public_web.add_argument("--request-id", type=UUID, required=True)
    recruiter_campus = subcommands.add_parser(
        "recruiter-campus-process",
        help="Process one existing public recruiting observation without re-fetching",
    )
    recruiter_campus.add_argument("--observation-id", type=UUID, required=True)
    calendar_sync = subcommands.add_parser(
        "calendar-sync", help="Run one durable Google Calendar sync request"
    )
    calendar_sync.add_argument("--request-id", type=UUID, required=True)
    worker = subcommands.add_parser("worker", help="Run the typed durable-work dispatcher")
    worker.add_argument(
        "--classes",
        default=",".join(item.value for item in _DEFAULT_WORKER_CLASSES),
        help="Comma-separated bounded worker lanes",
    )
    worker.add_argument("--batch-size", type=int, default=5)
    worker.add_argument("--lease-seconds", type=int, default=300)
    worker.add_argument("--poll-seconds", type=float, default=2)
    worker.add_argument("--once", action="store_true")
    scheduler = subcommands.add_parser("scheduler", help="Enqueue due recurring work")
    scheduler.add_argument("--poll-seconds", type=float, default=15)
    scheduler.add_argument("--once", action="store_true")
    subcommands.add_parser("list-sources", help="List configured ATS source IDs")
    return parser


async def _execute(arguments: argparse.Namespace) -> int:
    settings = Settings.from_environment()
    repository = PostgresCollectorRepository(settings.database_url)
    orchestration = PostgresOrchestrationRepository(settings.database_url)

    def dispatcher(lease_seconds: int) -> TypedWorkDispatcher:
        handlers = RuntimeWorkHandlers(settings=settings, orchestration=orchestration).mapping()
        return TypedWorkDispatcher(
            repository=orchestration,
            handlers=handlers,
            lease_seconds=lease_seconds,
        )

    async def finite(classes: tuple[WorkClass, ...], lease_seconds: int = 300) -> int:
        return await run_worker(
            repository=orchestration,
            dispatcher=dispatcher(lease_seconds),
            worker_instance=f"{socket.gethostname()}:{os.getpid()}",
            classes=classes,
            batch_size=1,
            lease_seconds=lease_seconds,
            poll_seconds=0.1,
            once=True,
        )

    if arguments.command == "list-sources":
        sources = await repository.list_sources()
        for source in sources:
            print(
                json.dumps(
                    {
                        "id": str(source.id),
                        "company": source.company_name,
                        "provider": source.provider,
                        "external_key": source.external_key,
                        "enabled": source.enabled,
                    },
                    separators=(",", ":"),
                )
            )
        return 0

    if arguments.command == "github-sync":
        if arguments.request_id is None:
            await orchestration.enqueue_github(arguments.repository_id)
        count = await finite((WorkClass.GITHUB,))
        print(json.dumps({"processed": count, "path": "orchestration"}))
        return 0

    if arguments.command == "public-web-work":
        count = await finite((WorkClass.WEB_SEARCH, WorkClass.WEB_FETCH, WorkClass.PROJECTION))
        print(json.dumps({"processed": count, "path": "orchestration"}))
        return 0

    if arguments.command == "recruiter-campus-process":
        await orchestration.enqueue_projection(arguments.observation_id)
        count = await finite((WorkClass.PROJECTION,))
        print(json.dumps({"processed": count, "path": "orchestration"}))
        return 0

    if arguments.command == "calendar-sync":
        count = await finite((WorkClass.CALENDAR,))
        print(json.dumps({"processed": count, "path": "orchestration"}))
        return 0

    if arguments.command == "worker":
        values = tuple(
            WorkClass(value.strip()) for value in arguments.classes.split(",") if value.strip()
        )
        if not values:
            raise ValueError("at least one worker class is required")
        if not 1 <= arguments.batch_size <= min(settings.max_concurrency, 20):
            raise ValueError("batch size exceeds configured bounded concurrency")
        count = await run_worker(
            repository=orchestration,
            dispatcher=dispatcher(arguments.lease_seconds),
            worker_instance=f"{socket.gethostname()}:{os.getpid()}",
            classes=values,
            batch_size=arguments.batch_size,
            lease_seconds=arguments.lease_seconds,
            poll_seconds=arguments.poll_seconds,
            once=arguments.once,
        )
        if arguments.once:
            print(json.dumps({"processed": count}))
        return 0

    if arguments.command == "scheduler":
        count = await run_scheduler(
            repository=orchestration,
            poll_seconds=arguments.poll_seconds,
            once=arguments.once,
        )
        if arguments.once:
            print(json.dumps({"enqueued": count}))
        return 0

    await orchestration.enqueue_ats(arguments.source_id)
    count = await finite((WorkClass.ATS,))
    print(json.dumps({"processed": count, "path": "orchestration"}))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    configure_logging()
    arguments = _parser().parse_args(argv)
    return asyncio.run(_execute(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
