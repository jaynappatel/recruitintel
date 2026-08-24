import asyncio
from typing import Protocol


class DistributedRateLimiter(Protocol):
    async def wait(
        self, scope_type: str, scope_key: str, minimum_interval_seconds: float
    ) -> None: ...


class RateLimitRepository(Protocol):
    async def acquire_rate_limit(
        self, scope_type: str, scope_key: str, minimum_interval_seconds: float
    ) -> float: ...


class PostgresDistributedRateLimiter:
    def __init__(self, repository: RateLimitRepository) -> None:
        self._repository = repository

    async def wait(self, scope_type: str, scope_key: str, minimum_interval_seconds: float) -> None:
        delay = await self._repository.acquire_rate_limit(
            scope_type, scope_key, minimum_interval_seconds
        )
        if delay > 0:
            await asyncio.sleep(delay)
