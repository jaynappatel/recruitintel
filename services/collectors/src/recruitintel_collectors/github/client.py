import asyncio
import base64
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol, cast
from urllib.parse import quote

import httpx

from .models import (
    GitHubChangedFile,
    GitHubComparison,
    GitHubFile,
    GitHubRateLimit,
    GitHubRepositoryMetadata,
)
from .normalization import validate_commit_sha

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class GitHubAPIResult[T]:
    value: T
    rate_limit: GitHubRateLimit


class GitHubAPIError(RuntimeError):
    def __init__(self, message: str, *, retryable: bool, status_code: int | None = None) -> None:
        super().__init__(message)
        self.retryable = retryable
        self.status_code = status_code


class GitHubRateLimitError(GitHubAPIError):
    def __init__(self, rate_limit: GitHubRateLimit) -> None:
        reset = rate_limit.reset_at.isoformat() if rate_limit.reset_at else "unknown"
        super().__init__(
            f"GitHub API rate limit exhausted; reset at {reset}",
            retryable=True,
            status_code=403,
        )
        self.rate_limit = rate_limit


class GitHubClient(Protocol):
    async def get_repository(
        self, owner: str, repository_name: str
    ) -> GitHubAPIResult[GitHubRepositoryMetadata]: ...

    async def get_latest_commit_sha(
        self, owner: str, repository_name: str, branch: str
    ) -> GitHubAPIResult[str]: ...

    async def compare_commits(
        self, owner: str, repository_name: str, previous_sha: str, current_sha: str
    ) -> GitHubAPIResult[GitHubComparison]: ...

    async def list_repository_files(
        self, owner: str, repository_name: str, commit_sha: str
    ) -> GitHubAPIResult[tuple[str, ...]]: ...

    async def get_file(
        self, owner: str, repository_name: str, source_path: str, commit_sha: str
    ) -> GitHubAPIResult[GitHubFile]: ...


class OfficialGitHubClient:
    RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})

    def __init__(
        self,
        *,
        user_agent: str,
        token: str | None = None,
        timeout_seconds: float = 20,
        requests_per_second: float = 1,
        max_attempts: int = 3,
        max_response_bytes: int = 10_000_000,
        transport: httpx.AsyncBaseTransport | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        if not user_agent.strip():
            raise ValueError("an identifying GitHub API user agent is required")
        if requests_per_second <= 0:
            raise ValueError("requests_per_second must be positive")
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": user_agent,
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = httpx.AsyncClient(
            base_url="https://api.github.com",
            headers=headers,
            follow_redirects=False,
            timeout=httpx.Timeout(timeout_seconds),
            limits=httpx.Limits(max_connections=5, max_keepalive_connections=3),
            transport=transport,
        )
        self._interval = 1 / requests_per_second
        self._max_attempts = max_attempts
        self._max_response_bytes = max_response_bytes
        self._sleep = sleep
        self._last_request = 0.0
        self._pace_lock = asyncio.Lock()
        self._latest_rate_limit = GitHubRateLimit()

    async def __aenter__(self) -> "OfficialGitHubClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _pace(self) -> None:
        async with self._pace_lock:
            delay = self._interval - (time.monotonic() - self._last_request)
            if delay > 0:
                await self._sleep(delay)
            self._last_request = time.monotonic()

    @staticmethod
    def _integer_header(headers: httpx.Headers, name: str) -> int | None:
        try:
            return int(headers[name])
        except (KeyError, ValueError):
            return None

    @classmethod
    def _rate_limit(cls, response: httpx.Response) -> GitHubRateLimit:
        reset_epoch = cls._integer_header(response.headers, "X-RateLimit-Reset")
        return GitHubRateLimit(
            limit=cls._integer_header(response.headers, "X-RateLimit-Limit"),
            remaining=cls._integer_header(response.headers, "X-RateLimit-Remaining"),
            used=cls._integer_header(response.headers, "X-RateLimit-Used"),
            reset_at=datetime.fromtimestamp(reset_epoch, tz=UTC) if reset_epoch else None,
        )

    async def _request_json(self, path: str) -> tuple[Any, GitHubRateLimit, httpx.Headers]:
        if self._latest_rate_limit.remaining == 0:
            reset = self._latest_rate_limit.reset_at
            if reset is None or reset > datetime.now(UTC):
                raise GitHubRateLimitError(self._latest_rate_limit)

        last_error: Exception | None = None
        for attempt in range(1, self._max_attempts + 1):
            await self._pace()
            try:
                response = await self._client.get(path)
                rate_limit = self._rate_limit(response)
                self._latest_rate_limit = rate_limit
                logger.info(
                    "github_rate_limit",
                    extra={
                        "remaining": rate_limit.remaining,
                        "limit": rate_limit.limit,
                        "reset_at": (
                            rate_limit.reset_at.isoformat() if rate_limit.reset_at else None
                        ),
                    },
                )
                if rate_limit.remaining == 0 and response.status_code in {403, 429}:
                    raise GitHubRateLimitError(rate_limit)
                secondary_limit = response.status_code == 403 and "Retry-After" in response.headers
                if (
                    response.status_code in self.RETRYABLE_STATUSES or secondary_limit
                ) and attempt < self._max_attempts:
                    try:
                        retry_after = min(float(response.headers.get("Retry-After", 0)), 60)
                    except ValueError:
                        retry_after = 0
                    await self._sleep(retry_after or float(2 ** (attempt - 1)))
                    continue
                if response.status_code >= 400:
                    raise GitHubAPIError(
                        f"GitHub API request failed with HTTP {response.status_code}",
                        retryable=(
                            response.status_code in self.RETRYABLE_STATUSES or secondary_limit
                        ),
                        status_code=response.status_code,
                    )
                if len(response.content) > self._max_response_bytes:
                    raise GitHubAPIError(
                        "GitHub API response exceeded the configured size limit", retryable=False
                    )
                return response.json(), rate_limit, response.headers
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                last_error = exc
                if attempt == self._max_attempts:
                    break
                await self._sleep(float(2 ** (attempt - 1)))
            except ValueError as exc:
                raise GitHubAPIError("GitHub API returned invalid JSON", retryable=False) from exc
        raise GitHubAPIError(
            f"GitHub API request failed after {self._max_attempts} attempts",
            retryable=True,
        ) from last_error

    async def get_repository(
        self, owner: str, repository_name: str
    ) -> GitHubAPIResult[GitHubRepositoryMetadata]:
        document, rate, _ = await self._request_json(f"/repos/{owner}/{repository_name}")
        return GitHubAPIResult(
            GitHubRepositoryMetadata(
                owner=owner,
                repository_name=repository_name,
                repository_url=f"https://github.com/{owner}/{repository_name}",
                default_branch=str(document["default_branch"]),
                archived=bool(document.get("archived", False)),
                disabled=bool(document.get("disabled", False)),
            ),
            rate,
        )

    async def get_latest_commit_sha(
        self, owner: str, repository_name: str, branch: str
    ) -> GitHubAPIResult[str]:
        encoded_branch = quote(branch, safe="")
        document, rate, _ = await self._request_json(
            f"/repos/{owner}/{repository_name}/commits/{encoded_branch}"
        )
        return GitHubAPIResult(validate_commit_sha(str(document["sha"])), rate)

    async def compare_commits(
        self, owner: str, repository_name: str, previous_sha: str, current_sha: str
    ) -> GitHubAPIResult[GitHubComparison]:
        previous = validate_commit_sha(previous_sha)
        current = validate_commit_sha(current_sha)
        document, rate, headers = await self._request_json(
            f"/repos/{owner}/{repository_name}/compare/{previous}...{current}"
        )
        files = tuple(
            GitHubChangedFile(
                path=str(item["filename"]),
                status=str(item.get("status", "modified")),
                previous_path=str(item["previous_filename"])
                if item.get("previous_filename")
                else None,
            )
            for item in document.get("files", [])
            if isinstance(item, dict) and item.get("filename")
        )
        complete = len(files) < 300 and 'rel="next"' not in headers.get("Link", "")
        return GitHubAPIResult(GitHubComparison(files=files, complete=complete), rate)

    async def list_repository_files(
        self, owner: str, repository_name: str, commit_sha: str
    ) -> GitHubAPIResult[tuple[str, ...]]:
        sha = validate_commit_sha(commit_sha)
        document, rate, _ = await self._request_json(
            f"/repos/{owner}/{repository_name}/git/trees/{sha}?recursive=1"
        )
        if document.get("truncated"):
            raise GitHubAPIError(
                "GitHub recursive tree response was truncated; configure narrower watched paths",
                retryable=False,
            )
        paths = tuple(
            str(item["path"])
            for item in document.get("tree", [])
            if isinstance(item, dict) and item.get("type") == "blob" and item.get("path")
        )
        return GitHubAPIResult(paths, rate)

    async def get_file(
        self, owner: str, repository_name: str, source_path: str, commit_sha: str
    ) -> GitHubAPIResult[GitHubFile]:
        sha = validate_commit_sha(commit_sha)
        encoded_path = quote(source_path, safe="/")
        document, rate, _ = await self._request_json(
            f"/repos/{owner}/{repository_name}/contents/{encoded_path}?ref={sha}"
        )
        if not isinstance(document, dict) or document.get("type") != "file":
            raise GitHubAPIError("configured GitHub path is not a file", retryable=False)
        if document.get("encoding") != "base64" or not isinstance(document.get("content"), str):
            raise GitHubAPIError(
                "GitHub file content is unavailable through the Contents API", retryable=False
            )
        try:
            decoded = base64.b64decode(document["content"], validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise GitHubAPIError(
                "GitHub file is not valid base64 UTF-8 text", retryable=False
            ) from exc
        source_url = f"https://github.com/{owner}/{repository_name}/blob/{sha}/{source_path}"
        return GitHubAPIResult(
            GitHubFile(
                path=source_path,
                source_url=source_url,
                commit_sha=sha,
                content=decoded,
                content_sha=cast(str | None, document.get("sha")),
            ),
            rate,
        )
