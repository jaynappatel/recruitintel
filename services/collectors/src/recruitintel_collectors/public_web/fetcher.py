import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from email.message import Message
from types import TracebackType
from typing import Protocol, Self
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

from .models import FetchedDocument
from .urls import DnsResolver, SystemDnsResolver, validate_public_url

logger = logging.getLogger(__name__)


class RobotsDeniedError(PermissionError):
    pass


class ResponseTooLargeError(ValueError):
    pass


class UnsupportedContentTypeError(ValueError):
    pass


class RobotsPolicy(Protocol):
    async def allowed(self, url: str, user_agent: str) -> bool: ...


class CachedRobotsPolicy:
    def __init__(
        self,
        *,
        client: httpx.AsyncClient,
        resolver: DnsResolver,
        max_bytes: int = 256_000,
    ) -> None:
        self._client = client
        self._resolver = resolver
        self._max_bytes = max_bytes
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
        robots_url = await validate_public_url(f"{origin}/robots.txt", self._resolver)
        try:
            response = await self._client.get(
                robots_url,
                headers={"User-Agent": user_agent, "Accept": "text/plain"},
                follow_redirects=False,
            )
        except httpx.HTTPError:
            logger.warning("robots_fetch_failed", extra={"origin": origin})
            return None
        if response.status_code in {401, 403}:
            parser = RobotFileParser()
            parser.parse(["User-agent: *", "Disallow: /"])
            return parser
        if response.status_code < 200 or response.status_code >= 300:
            return None
        if len(response.content) > self._max_bytes:
            logger.warning("robots_response_too_large", extra={"origin": origin})
            return None
        parser = RobotFileParser()
        parser.set_url(robots_url)
        parser.parse(response.text.splitlines())
        return parser


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
        robots_policy: RobotsPolicy | None = None,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        self._user_agent = user_agent
        self._max_response_bytes = max_response_bytes
        self._max_redirects = max_redirects
        self._max_attempts = max_attempts
        self._resolver = resolver or SystemDnsResolver()
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds, follow_redirects=False)
        self._owns_client = client is None
        self._robots = robots_policy or CachedRobotsPolicy(
            client=self._client,
            resolver=self._resolver,
        )
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
        if self._owns_client:
            await self._client.aclose()

    async def fetch(self, url: str) -> FetchedDocument:
        requested_url = await validate_public_url(url, self._resolver)
        current_url = requested_url
        redirects = 0
        while True:
            current_url = await validate_public_url(current_url, self._resolver)
            if not await self._robots.allowed(current_url, self._user_agent):
                raise RobotsDeniedError(f"robots.txt disallows {current_url}")
            hostname = urlsplit(current_url).hostname or ""
            await self._limiter.wait(hostname)
            response = await self._request_with_retries(current_url)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                await response.aclose()
                if not location:
                    raise httpx.HTTPStatusError(
                        "redirect response did not include Location",
                        request=response.request,
                        response=response,
                    )
                redirects += 1
                if redirects > self._max_redirects:
                    raise httpx.TooManyRedirects("too many redirects", request=response.request)
                current_url = urljoin(current_url, location)
                continue
            try:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").casefold()
                media_type = content_type.split(";", 1)[0].strip()
                if media_type not in {"text/html", "application/xhtml+xml"}:
                    raise UnsupportedContentTypeError(f"unsupported content type {media_type!r}")
                length = response.headers.get("content-length")
                if length and int(length) > self._max_response_bytes:
                    raise ResponseTooLargeError("response exceeds configured content size limit")
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > self._max_response_bytes:
                        raise ResponseTooLargeError(
                            "response exceeds configured content size limit"
                        )
            finally:
                await response.aclose()
            safe_headers = {
                key: value
                for key, value in response.headers.items()
                if key.casefold() in {"content-type", "content-length", "etag", "last-modified"}
            }
            return FetchedDocument(
                requested_url=requested_url,
                final_url=str(response.url),
                status_code=response.status_code,
                content_type=media_type,
                body=bytes(body).decode(_charset(content_type), errors="replace"),
                headers=safe_headers,
            )

    async def _request_with_retries(self, url: str) -> httpx.Response:
        last_error: Exception | None = None
        for attempt in range(self._max_attempts):
            request = self._client.build_request(
                "GET",
                url,
                headers={
                    "User-Agent": self._user_agent,
                    "Accept": "text/html,application/xhtml+xml",
                },
            )
            try:
                response = await self._client.send(request, stream=True)
                if response.status_code != 429 and response.status_code < 500:
                    return response
                await response.aclose()
                last_error = httpx.HTTPStatusError(
                    f"retryable HTTP status {response.status_code}",
                    request=request,
                    response=response,
                )
            except httpx.RequestError as exc:
                last_error = exc
            if attempt + 1 < self._max_attempts:
                delay = min(2**attempt, 8)
                logger.warning(
                    "public_web_fetch_retry",
                    extra={"url": url, "attempt": attempt + 1, "delay_seconds": delay},
                )
                await self._sleep(float(delay))
        if last_error is None:
            raise RuntimeError("fetch retry loop ended without a result")
        raise last_error
