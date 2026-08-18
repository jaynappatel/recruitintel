import argparse
import asyncio
import json
from collections.abc import Sequence
from pathlib import Path
from uuid import UUID

from recruitintel_collectors.adapters import GreenhouseCollector, LeverCollector
from recruitintel_collectors.config import Settings
from recruitintel_collectors.github.client import OfficialGitHubClient
from recruitintel_collectors.github.runner import GitHubSyncRunner
from recruitintel_collectors.infrastructure.github_postgres import PostgresGitHubSyncRepository
from recruitintel_collectors.infrastructure.http import ProviderHttpClient
from recruitintel_collectors.infrastructure.postgres import PostgresCollectorRepository
from recruitintel_collectors.infrastructure.public_web_postgres import PostgresPublicWebRepository
from recruitintel_collectors.infrastructure.recruiter_campus_postgres import (
    PostgresRecruiterCampusRepository,
)
from recruitintel_collectors.logging import configure_logging
from recruitintel_collectors.pipeline import CollectorRunner
from recruitintel_collectors.public_web.fetcher import SafePublicWebFetcher
from recruitintel_collectors.public_web.runner import PublicWebWorker
from recruitintel_collectors.public_web.search import JsonFileSearchProvider, StaticSearchProvider


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
    subcommands.add_parser("list-sources", help="List configured ATS source IDs")
    return parser


async def _execute(arguments: argparse.Namespace) -> int:
    settings = Settings.from_environment()
    repository = PostgresCollectorRepository(settings.database_url)

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
        github_repository = PostgresGitHubSyncRepository(settings.database_url)
        async with OfficialGitHubClient(
            user_agent=settings.user_agent,
            token=settings.github_token,
            timeout_seconds=settings.timeout_seconds,
            requests_per_second=min(settings.requests_per_second, 2),
            max_response_bytes=settings.max_response_bytes,
        ) as github:
            github_runner = GitHubSyncRunner(
                repository=github_repository,
                client=github,
                max_concurrency=min(settings.max_concurrency, 5),
            )
            github_stats = await github_runner.run(
                arguments.repository_id, request_id=arguments.request_id
            )
            print(github_stats.model_dump_json())
            return 0

    if arguments.command == "public-web-work":
        static_provider: StaticSearchProvider
        if settings.public_web_static_results_file:
            static_provider = JsonFileSearchProvider(Path(settings.public_web_static_results_file))
        else:
            static_provider = StaticSearchProvider({})
        public_web_repository = PostgresPublicWebRepository(settings.database_url)
        recruiter_campus_repository = PostgresRecruiterCampusRepository(settings.database_url)
        async with SafePublicWebFetcher(
            user_agent=settings.user_agent,
            timeout_seconds=settings.timeout_seconds,
            max_response_bytes=settings.public_web_max_response_bytes,
            requests_per_second=settings.public_web_requests_per_second,
        ) as public_fetcher:
            public_worker = PublicWebWorker(
                repository=public_web_repository,
                search_providers={static_provider.name: static_provider},
                fetcher=public_fetcher,
                recruiter_campus_processor=recruiter_campus_repository,
            )
            public_stats = await public_worker.run(arguments.request_id)
            print(public_stats.model_dump_json())
            return 0

    if arguments.command == "recruiter-campus-process":
        recruiter_campus_repository = PostgresRecruiterCampusRepository(settings.database_url)
        recruiter_stats = await recruiter_campus_repository.process_observation(
            arguments.observation_id
        )
        print(recruiter_stats.model_dump_json())
        return 0

    async with ProviderHttpClient(
        user_agent=settings.user_agent,
        timeout_seconds=settings.timeout_seconds,
        requests_per_second=settings.requests_per_second,
        max_response_bytes=settings.max_response_bytes,
    ) as http:
        registry = {
            "greenhouse": GreenhouseCollector(http),
            "lever": LeverCollector(http),
        }
        collector_runner = CollectorRunner(repository=repository, registry=registry)
        collector_stats = await collector_runner.run(arguments.source_id)
        print(collector_stats.model_dump_json())
        return 0


def main(argv: Sequence[str] | None = None) -> int:
    configure_logging()
    arguments = _parser().parse_args(argv)
    return asyncio.run(_execute(arguments))


if __name__ == "__main__":
    raise SystemExit(main())
