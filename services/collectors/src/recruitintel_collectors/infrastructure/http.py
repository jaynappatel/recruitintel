import asyncio
import email.utils
import json
import random
import time
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from .rate_limit import DistributedRateLimiter

_JITTER = random.SystemRandom()


class UnsafeProviderUrlError(ValueError):
    pass


class ResponseTooLargeError(RuntimeError):
    pass


class ProviderRateLimitError(RuntimeError):
    def __init__(self, retry_after_seconds: int | None) -> None:
        super().__init__("provider requested durable rate-limit backoff")
        self.retry_after_seconds = retry_after_seconds


class ProviderHttpClient:
    RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})

    def __init__(
        self,
        *,
        user_agent: str,
        timeout_seconds: float = 20,
        requests_per_second: float = 2,
        max_response_bytes: int = 10_000_000,
        max_attempts: int = 3,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        distributed_limiter: DistributedRateLimiter | None = None,
    ) -> None:
        if not user_agent.strip():
            raise ValueError("an identifying user agent is required")
        if requests_per_second <= 0:
            raise ValueError("requests_per_second must be positive")
        self._interval = 1 / requests_per_second
        self._max_response_bytes = max_response_bytes
        self._max_attempts = max_attempts
        self._sleep = sleep
        self._distributed_limiter = distributed_limiter
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_request: dict[str, float] = {}
        self._client = httpx.AsyncClient(
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
            transport=transport,
        )

    async def __aenter__(self) -> "ProviderHttpClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    @staticmethod
    def validate_url(url: str, allowed_hosts: frozenset[str]) -> str:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            raise UnsafeProviderUrlError("provider URL must use HTTPS")
        if not host or host not in allowed_hosts:
            raise UnsafeProviderUrlError(f"provider host {host!r} is not allowlisted")
        if parsed.username or parsed.password or parsed.port not in {None, 443}:
            raise UnsafeProviderUrlError("provider URL contains disallowed authority components")
        return host

    async def _pace(self, host: str) -> None:
        if self._distributed_limiter is not None:
            await self._distributed_limiter.wait("HOST", host, self._interval)
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            delay = self._interval - (now - self._last_request.get(host, 0))
            if delay > 0:
                await self._sleep(delay)
            self._last_request[host] = time.monotonic()

    @staticmethod
    def _retry_after(response: httpx.Response) -> float | None:
        value = response.headers.get("Retry-After")
        if not value:
            return None
        try:
            return max(0, min(float(value), 604800))
        except ValueError:
            try:
                retry_at = email.utils.parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=UTC)
                return max(
                    0,
                    min((retry_at - datetime.now(UTC)).total_seconds(), 604800),
                )
            except (TypeError, ValueError, OverflowError):
                return None

    async def get_json(self, url: str, *, allowed_hosts: frozenset[str]) -> Any:
        host = self.validate_url(url, allowed_hosts)
        last_error: Exception | None = None

        for attempt in range(1, self._max_attempts + 1):
            await self._pace(host)
            try:
                async with self._client.stream("GET", url) as response:
                    retry_after = self._retry_after(response)
                    if response.status_code == 429 and (
                        attempt == self._max_attempts
                        or (retry_after is not None and retry_after > 5)
                    ):
                        await response.aread()
                        raise ProviderRateLimitError(
                            int(retry_after) if retry_after is not None else None
                        )
                    if (
                        response.status_code in self.RETRYABLE_STATUSES
                        and attempt < self._max_attempts
                    ):
                        await response.aread()
                        delay = retry_after if retry_after is not None else 2 ** (attempt - 1)
                        await self._sleep(delay + _JITTER.uniform(0, 0.25))
                        continue
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > self._max_response_bytes:
                            raise ResponseTooLargeError(
                                f"response exceeded {self._max_response_bytes} bytes"
                            )
                return json.loads(body)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt == self._max_attempts:
                    break
                await self._sleep(2 ** (attempt - 1) + _JITTER.uniform(0, 0.25))
            except json.JSONDecodeError as exc:
                raise ValueError("provider returned invalid JSON") from exc

        raise RuntimeError(
            f"provider request failed after {self._max_attempts} attempts"
        ) from last_error
