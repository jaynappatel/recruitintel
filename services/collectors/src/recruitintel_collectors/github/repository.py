from typing import Protocol
from uuid import UUID

from .models import (
    GitHubParsedBatch,
    GitHubRateLimit,
    GitHubRepositoryConfig,
    GitHubSyncStats,
)
from .resolution import GitHubCompanyResolver


class GitHubSyncRepository(Protocol):
    async def get_repository(self, repository_id: UUID) -> GitHubRepositoryConfig: ...

    async def get_company_resolver(
        self, repository: GitHubRepositoryConfig
    ) -> GitHubCompanyResolver: ...

    async def create_sync_run(
        self, repository: GitHubRepositoryConfig, *, request_id: UUID | None = None
    ) -> UUID: ...

    async def complete_unchanged(
        self,
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        current_sha: str,
        rate_limit: GitHubRateLimit,
        duration_ms: int,
        request_id: UUID | None = None,
    ) -> GitHubSyncStats: ...

    async def persist_sync(
        self,
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        current_sha: str,
        files_inspected: tuple[str, ...],
        batch: GitHubParsedBatch,
        rate_limit: GitHubRateLimit,
        duration_ms: int,
        request_id: UUID | None = None,
    ) -> GitHubSyncStats: ...

    async def fail_sync(
        self,
        *,
        run_id: UUID,
        repository: GitHubRepositoryConfig,
        error: Exception,
        retryable: bool,
        rate_limit: GitHubRateLimit,
        duration_ms: int,
        request_id: UUID | None = None,
    ) -> None: ...
