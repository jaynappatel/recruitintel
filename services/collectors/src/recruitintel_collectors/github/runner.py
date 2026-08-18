import asyncio
import logging
import time
from pathlib import PurePosixPath
from uuid import UUID

from .client import GitHubAPIError, GitHubAPIResult, GitHubClient, GitHubRateLimitError
from .models import (
    GitHubFile,
    GitHubParsedBatch,
    GitHubRateLimit,
    GitHubRepositoryConfig,
    GitHubSyncStats,
    ResolvedGitHubJob,
    ResolvedInterviewQuestion,
    UnresolvedGitHubRecord,
)
from .normalize_records import GitHubRecordNormalizer
from .repository import GitHubSyncRepository

logger = logging.getLogger(__name__)
_SUPPORTED_SUFFIXES = frozenset({".md", ".markdown", ".csv", ".json"})


def has_relevant_sha_change(previous_sha: str | None, current_sha: str) -> bool:
    return previous_sha != current_sha


def _is_watched(path: str, watched_paths: tuple[str, ...]) -> bool:
    if PurePosixPath(path).suffix.casefold() not in _SUPPORTED_SUFFIXES:
        return False
    if not watched_paths:
        return True
    return any(
        path == watched or path.startswith(f"{watched.rstrip('/')}/") for watched in watched_paths
    )


class GitHubSyncRunner:
    def __init__(
        self,
        *,
        repository: GitHubSyncRepository,
        client: GitHubClient,
        normalizer: GitHubRecordNormalizer | None = None,
        max_concurrency: int = 3,
    ) -> None:
        if max_concurrency < 1 or max_concurrency > 10:
            raise ValueError("GitHub sync concurrency must be between 1 and 10")
        self.repository = repository
        self.client = client
        self.normalizer = normalizer or GitHubRecordNormalizer()
        self.max_concurrency = max_concurrency

    async def _relevant_paths(
        self,
        repository: GitHubRepositoryConfig,
        *,
        previous_sha: str | None,
        current_sha: str,
    ) -> tuple[tuple[str, ...], GitHubRateLimit]:
        if previous_sha:
            comparison = await self.client.compare_commits(
                repository.owner,
                repository.repository_name,
                previous_sha,
                current_sha,
            )
            if comparison.value.complete:
                paths = tuple(
                    sorted(
                        {
                            item.path
                            for item in comparison.value.files
                            if item.status != "removed"
                            and _is_watched(item.path, repository.watched_paths)
                        }
                    )
                )
                return paths, comparison.rate_limit

        tree = await self.client.list_repository_files(
            repository.owner, repository.repository_name, current_sha
        )
        paths = tuple(
            sorted(path for path in tree.value if _is_watched(path, repository.watched_paths))
        )
        return paths, tree.rate_limit

    async def _fetch_files(
        self,
        repository: GitHubRepositoryConfig,
        paths: tuple[str, ...],
        current_sha: str,
    ) -> tuple[GitHubAPIResult[GitHubFile], ...]:
        semaphore = asyncio.Semaphore(self.max_concurrency)

        async def fetch(path: str) -> GitHubAPIResult[GitHubFile]:
            async with semaphore:
                return await self.client.get_file(
                    repository.owner, repository.repository_name, path, current_sha
                )

        return tuple(await asyncio.gather(*(fetch(path) for path in paths)))

    async def run(self, repository_id: UUID, *, request_id: UUID | None = None) -> GitHubSyncStats:
        started = time.monotonic()
        repository = await self.repository.get_repository(repository_id)
        run_id = await self.repository.create_sync_run(repository, request_id=request_id)
        latest_rate = GitHubRateLimit()
        try:
            metadata_result = await self.client.get_repository(
                repository.owner, repository.repository_name
            )
            latest_rate = metadata_result.rate_limit
            metadata = metadata_result.value
            if metadata.archived or metadata.disabled:
                raise GitHubAPIError(
                    "GitHub repository is archived or disabled and cannot be synchronized",
                    retryable=False,
                )
            branch = repository.default_branch or metadata.default_branch
            repository = repository.model_copy(update={"default_branch": branch})
            commit_result = await self.client.get_latest_commit_sha(
                repository.owner, repository.repository_name, branch
            )
            latest_rate = commit_result.rate_limit
            current_sha = commit_result.value
            if not has_relevant_sha_change(repository.last_processed_commit_sha, current_sha):
                duration_ms = int((time.monotonic() - started) * 1000)
                stats = await self.repository.complete_unchanged(
                    run_id=run_id,
                    repository=repository,
                    current_sha=current_sha,
                    rate_limit=latest_rate,
                    duration_ms=duration_ms,
                    request_id=request_id,
                )
                logger.info("github_sync_unchanged", extra=stats.model_dump(mode="json"))
                return stats

            paths, latest_rate = await self._relevant_paths(
                repository,
                previous_sha=repository.last_processed_commit_sha,
                current_sha=current_sha,
            )
            configured_limit = repository.metadata.get("max_files_per_sync", 50)
            max_files = min(max(int(configured_limit), 1), 200)
            if len(paths) > max_files:
                raise GitHubAPIError(
                    f"sync selected {len(paths)} files, exceeding the configured limit {max_files}",
                    retryable=False,
                )

            company_resolver = await self.repository.get_company_resolver(repository)
            file_results = await self._fetch_files(repository, paths, current_sha)
            questions: list[ResolvedInterviewQuestion] = []
            jobs: list[ResolvedGitHubJob] = []
            unresolved: list[UnresolvedGitHubRecord] = []
            for result in file_results:
                latest_rate = result.rate_limit
                parsed = self.normalizer.normalize_file(
                    repository=repository,
                    file=result.value,
                    company_resolver=company_resolver,
                )
                questions.extend(parsed.questions)
                jobs.extend(parsed.jobs)
                unresolved.extend(parsed.unresolved)
            batch = GitHubParsedBatch(
                questions=tuple(questions), jobs=tuple(jobs), unresolved=tuple(unresolved)
            )
            duration_ms = int((time.monotonic() - started) * 1000)
            stats = await self.repository.persist_sync(
                run_id=run_id,
                repository=repository,
                current_sha=current_sha,
                files_inspected=paths,
                batch=batch,
                rate_limit=latest_rate,
                duration_ms=duration_ms,
                request_id=request_id,
            )
            logger.info(
                "github_sync_succeeded",
                extra={
                    **stats.model_dump(mode="json"),
                    "rate_limit_remaining": latest_rate.remaining,
                    "rate_limit_reset_at": (
                        latest_rate.reset_at.isoformat() if latest_rate.reset_at else None
                    ),
                },
            )
            return stats
        except Exception as exc:
            duration_ms = int((time.monotonic() - started) * 1000)
            retryable = isinstance(exc, GitHubAPIError) and exc.retryable
            if isinstance(exc, GitHubRateLimitError):
                latest_rate = exc.rate_limit
            try:
                await self.repository.fail_sync(
                    run_id=run_id,
                    repository=repository,
                    error=exc,
                    retryable=retryable,
                    rate_limit=latest_rate,
                    duration_ms=duration_ms,
                    request_id=request_id,
                )
            except Exception:
                logger.exception(
                    "github_sync_error_recording_failed",
                    extra={"repository_id": str(repository.id), "run_id": str(run_id)},
                )
            raise
