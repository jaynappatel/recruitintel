import asyncio
import email.utils
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import UTC, datetime
from email.message import Message
from types import TracebackType
from typing import Protocol, Self
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from recruitintel_collectors.infrastructure.rate_limit import DistributedRateLimiter

from .models import FetchedDocument
from .transport import (
    PinnedHttpResponse,
    PinnedPublicHttpClient,
    ResponseLimitExceededError,
)
from .urls import DnsResolver, SystemDnsResolver, canonicalize_url, resolve_public_url

logger = logging.getLogger(__name__)


class RobotsDeniedError(PermissionError):
    pass


class RobotsUnavailableError(RuntimeError):
    pass


class RestrictedSiteError(RobotsDeniedError):
    """A public URL may be retained as evidence but must not be fetched automatically."""


class ResponseTooLargeError(ValueError):
    pass


class UnsupportedContentTypeError(ValueError):
    pass


class PublicWebRateLimitedError(RuntimeError):
    def __init__(self, retry_after_seconds: int | None) -> None:
        super().__init__("public source requested durable rate-limit backoff")
        self.retry_after_seconds = retry_after_seconds


class PublicHttpRequester(Protocol):
    async def request(
        self, url: str, *, headers: Mapping[str, str], max_bytes: int
    ) -> PinnedHttpResponse: ...


class _TestHttpxRequester:
    """Explicit test seam; production construction always uses the pinned client."""

    def __init__(self, client: httpx.AsyncClient, resolver: DnsResolver) -> None:
        self._client = client
        self._resolver = resolver

    async def request(
        self, url: str, *, headers: Mapping[str, str], max_bytes: int
    ) -> PinnedHttpResponse:
        destination = await resolve_public_url(url, self._resolver)
        request = self._client.build_request("GET", destination.url, headers=headers)
        response = await self._client.send(request, stream=True)
        try:
            length = response.headers.get("content-length")
            if length and int(length) > max_bytes:
                raise ResponseLimitExceededError("response exceeds configured size limit")
            body = bytearray()
            async for chunk in response.aiter_bytes():
                body.extend(chunk)
                if len(body) > max_bytes:
                    raise ResponseLimitExceededError("response exceeds configured size limit")
            return PinnedHttpResponse(
                status_code=response.status_code,
                headers=response.headers,
                content=bytes(body),
                url=str(response.url),
            )
        finally:
            await response.aclose()


class RobotsPolicy(Protocol):
    async def allowed(self, url: str, user_agent: str) -> bool: ...


class CachedRobotsPolicy:
    def __init__(
        self,
        *,
        requester: PublicHttpRequester,
        max_bytes: int = 256_000,
        max_redirects: int = 3,
    ) -> None:
        self._requester = requester
        self._max_bytes = max_bytes
        self._max_redirects = max_redirects
        self._cache: dict[str, RobotFileParser | None] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def allowed(self, url: str, user_agent: str) -> bool:
        parsed = urlsplit(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in self._cache:
            lock = self._locks.setdefault(origin, asyncio.Lock())
            async with lock:
                if origin not in self._cache:
                    self._cache[origin] = await self._load(origin, user_agent)
        parser = self._cache[origin]
        return True if parser is None else parser.can_fetch(user_agent, url)

    async def _load(self, origin: str, user_agent: str) -> RobotFileParser | None:
        robots_url = f"{origin}/robots.txt"
        for redirect in range(self._max_redirects + 1):
            try:
                response = await self._requester.request(
                    robots_url,
                    headers={"User-Agent": user_agent, "Accept": "text/plain"},
                    max_bytes=self._max_bytes,
                )
            except (httpx.HTTPError, ResponseLimitExceededError) as error:
                logger.warning("robots_fetch_failed", extra={"origin": origin})
                raise RobotsUnavailableError(
                    "robots policy could not be retrieved safely"
                ) from error
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location or redirect == self._max_redirects:
                    raise RobotsUnavailableError("robots redirect policy could not be resolved")
                next_url = canonicalize_url(urljoin(robots_url, location))
                if urlsplit(robots_url).scheme == "https" and urlsplit(next_url).scheme != "https":
                    raise RobotsUnavailableError("robots redirect attempted an HTTPS downgrade")
                robots_url = next_url
                continue
            if response.status_code in {401, 403}:
                parser = RobotFileParser()
                parser.parse(["User-agent: *", "Disallow: /"])
                return parser
            if response.status_code in {404, 410}:
                return None
            if response.status_code < 200 or response.status_code >= 300:
                raise RobotsUnavailableError("robots endpoint returned a transient failure")
            parser = RobotFileParser()
            parser.set_url(robots_url)
            parser.parse(response.content.decode("utf-8", errors="replace").splitlines())
            return parser
        raise RobotsUnavailableError("robots redirect loop ended unexpectedly")


class HostRateLimiter:
    def __init__(self, requests_per_second: float) -> None:
        if requests_per_second <= 0:
            raise ValueError("requests_per_second must be positive")
        self._minimum_interval = 1 / requests_per_second
        self._locks: dict[str, asyncio.Lock] = {}
        self._last_request: dict[str, float] = {}

    async def wait(self, hostname: str) -> None:
        lock = self._locks.setdefault(hostname, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            remaining = self._minimum_interval - (now - self._last_request.get(hostname, 0))
            if remaining > 0:
                await asyncio.sleep(remaining)
            self._last_request[hostname] = time.monotonic()


def _charset(content_type: str) -> str:
    message = Message()
    message["content-type"] = content_type
    return message.get_content_charset() or "utf-8"


class SafePublicWebFetcher:
    def __init__(
        self,
        *,
        user_agent: str,
        timeout_seconds: float = 20,
        max_response_bytes: int = 5_000_000,
        requests_per_second: float = 1,
        max_redirects: int = 5,
        max_attempts: int = 3,
        resolver: DnsResolver | None = None,
        client: httpx.AsyncClient | None = None,
        requester: PublicHttpRequester | None = None,
        robots_policy: RobotsPolicy | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
        distributed_limiter: DistributedRateLimiter | None = None,
        host_policy_check: Callable[[str, str, int], Awaitable[None]] | None = None,
    ) -> None:
        self._user_agent = user_agent
        self._max_response_bytes = max_response_bytes
        self._max_redirects = max_redirects
        self._max_attempts = max_attempts
        active_resolver = resolver or SystemDnsResolver()
        if client is not None and requester is not None:
            raise ValueError("client and requester are mutually exclusive")
        self._requester = requester or (
            _TestHttpxRequester(client, active_resolver)
            if client is not None
            else PinnedPublicHttpClient(
                resolver=active_resolver,
                timeout_seconds=timeout_seconds,
                distributed_limiter=distributed_limiter,
                minimum_interval_seconds=1 / requests_per_second,
                host_policy_check=host_policy_check,
            )
        )
        self._robots = robots_policy or CachedRobotsPolicy(requester=self._requester)
        self._limiter = HostRateLimiter(requests_per_second)
        self._sleep = sleep or asyncio.sleep

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        del exc_type, exc, traceback

    async def fetch(self, url: str) -> FetchedDocument:
        self._enforce_site_policy(url)
        requested_url = canonicalize_url(url)
        current_url = requested_url
        redirects = 0
        while True:
            self._enforce_site_policy(current_url)
            current_url = canonicalize_url(current_url)
            if not await self._robots.allowed(current_url, self._user_agent):
                raise RobotsDeniedError("robots.txt disallows this public URL")
            hostname = urlsplit(current_url).hostname or ""
            await self._limiter.wait(hostname)
            response = await self._request_with_retries(current_url)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    raise httpx.HTTPStatusError(
                        "redirect response did not include Location",
                        request=httpx.Request("GET", current_url),
                        response=httpx.Response(response.status_code),
                    )
                redirects += 1
                if redirects > self._max_redirects:
                    raise httpx.TooManyRedirects(
                        "too many redirects", request=httpx.Request("GET", current_url)
                    )
                next_url = canonicalize_url(urljoin(current_url, location))
                if urlsplit(current_url).scheme == "https" and urlsplit(next_url).scheme != "https":
                    raise RestrictedSiteError("HTTPS downgrade redirects are blocked")
                current_url = next_url
                continue
            if response.status_code < 200 or response.status_code >= 300:
                request = httpx.Request("GET", current_url)
                raise httpx.HTTPStatusError(
                    f"public fetch returned HTTP {response.status_code}",
                    request=request,
                    response=httpx.Response(response.status_code, request=request),
                )
            content_type = response.headers.get("content-type", "").casefold()
            media_type = content_type.split(";", 1)[0].strip()
            if media_type not in {"text/html", "application/xhtml+xml"}:
                raise UnsupportedContentTypeError(f"unsupported content type {media_type!r}")
            safe_headers = {
                key: value
                for key, value in response.headers.items()
                if key.casefold() in {"content-type", "content-length", "etag", "last-modified"}
            }
            return FetchedDocument(
                requested_url=requested_url,
                final_url=response.url,
                status_code=response.status_code,
                content_type=media_type,
                body=response.content.decode(_charset(content_type), errors="replace"),
                headers=safe_headers,
            )

    @staticmethod
    def _enforce_site_policy(url: str) -> None:
        hostname = (urlsplit(url).hostname or "").casefold().rstrip(".")
        if hostname == "linkedin.com" or hostname.endswith(".linkedin.com"):
            raise RestrictedSiteError(
                "LinkedIn URLs may be retained from permitted search results but are not fetched"
            )

    async def _request_with_retries(self, url: str) -> PinnedHttpResponse:
        last_error: Exception | None = None
        for attempt in range(self._max_attempts):
            try:
                response = await self._requester.request(
                    url,
                    headers={
                        "User-Agent": self._user_agent,
                        "Accept": "text/html,application/xhtml+xml",
                    },
                    max_bytes=self._max_response_bytes,
                )
                if response.status_code != 429 and response.status_code < 500:
                    return response
                if response.status_code == 429:
                    retry_after = self._retry_after(response.headers.get("Retry-After"))
                    last_error = PublicWebRateLimitedError(retry_after)
                    if attempt + 1 == self._max_attempts or (
                        retry_after is not None and retry_after > 5
                    ):
                        raise last_error
                else:
                    last_error = httpx.HTTPStatusError(
                        f"retryable HTTP status {response.status_code}",
                        request=httpx.Request("GET", url),
                        response=httpx.Response(response.status_code),
                    )
            except ResponseLimitExceededError as error:
                raise ResponseTooLargeError(
                    "response exceeds configured content size limit"
                ) from error
            except httpx.RequestError as error:
                last_error = error
            if attempt + 1 < self._max_attempts:
                delay = (
                    last_error.retry_after_seconds
                    if isinstance(last_error, PublicWebRateLimitedError)
                    and last_error.retry_after_seconds is not None
                    else min(2**attempt, 8)
                )
                logger.warning(
                    "public_web_fetch_retry",
                    extra={
                        "hostname": urlsplit(url).hostname,
                        "attempt": attempt + 1,
                        "delay_seconds": delay,
                    },
                )
                await self._sleep(float(delay))
        if last_error is None:
            raise RuntimeError("fetch retry loop ended without a result")
        raise last_error

    @staticmethod
    def _retry_after(value: str | None) -> int | None:
        if not value:
            return None
        try:
            return max(0, min(int(float(value)), 604800))
        except ValueError:
            try:
                retry_at = email.utils.parsedate_to_datetime(value)
                if retry_at.tzinfo is None:
                    retry_at = retry_at.replace(tzinfo=UTC)
                return max(0, min(int((retry_at - datetime.now(UTC)).total_seconds()), 604800))
            except (TypeError, ValueError, OverflowError):
                return None
