from __future__ import annotations

import ssl
from collections.abc import AsyncIterator, Awaitable, Callable, Iterable, Mapping
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Self

import httpcore
import httpx

from recruitintel_collectors.infrastructure.rate_limit import DistributedRateLimiter

from .urls import DnsResolver, ResolvedPublicUrl, canonicalize_url, resolve_public_url

_SOCKET_OPTION = (
    tuple[int, int, int] | tuple[int, int, bytes | bytearray] | tuple[int, int, None, int]
)


class ResponseLimitExceededError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class PinnedHttpResponse:
    status_code: int
    headers: httpx.Headers
    content: bytes
    url: str


class _CoreResponseStream(httpx.AsyncByteStream):
    def __init__(self, stream: Any) -> None:
        self._stream = stream

    async def __aiter__(self) -> AsyncIterator[bytes]:
        async for part in self._stream:
            yield part

    async def aclose(self) -> None:
        await self._stream.aclose()


class PinnedNetworkBackend(httpcore.AsyncNetworkBackend):
    """Dial one validated IP while leaving the HTTP/TLS origin hostname untouched."""

    def __init__(
        self,
        *,
        original_hostname: str,
        approved_address: str,
        delegate: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self.original_hostname = original_hostname.casefold().rstrip(".")
        self.approved_address = approved_address
        self.delegate = delegate or httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109 -- httpcore interface
        local_address: str | None = None,
        socket_options: Iterable[_SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        if host.casefold().rstrip(".") != self.original_hostname:
            raise httpcore.ConnectError("pinned transport received an unexpected hostname")
        return await self.delegate.connect_tcp(
            self.approved_address,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109 -- httpcore interface
        socket_options: Iterable[_SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del path, timeout, socket_options
        raise httpcore.ConnectError("Unix sockets are not supported by public fetches")

    async def sleep(self, seconds: float) -> None:
        await self.delegate.sleep(seconds)


_EXCEPTION_MAP: tuple[tuple[type[Exception], type[httpx.RequestError]], ...] = (
    (httpcore.ConnectTimeout, httpx.ConnectTimeout),
    (httpcore.ReadTimeout, httpx.ReadTimeout),
    (httpcore.WriteTimeout, httpx.WriteTimeout),
    (httpcore.PoolTimeout, httpx.PoolTimeout),
    (httpcore.ConnectError, httpx.ConnectError),
    (httpcore.ReadError, httpx.ReadError),
    (httpcore.WriteError, httpx.WriteError),
    (httpcore.ProxyError, httpx.ProxyError),
    (httpcore.UnsupportedProtocol, httpx.UnsupportedProtocol),
)


class PinnedAsyncTransport(httpx.AsyncBaseTransport):
    """Small reviewed bridge for httpx 0.28.1/httpcore 1.0.9."""

    def __init__(
        self,
        destination: ResolvedPublicUrl,
        approved_address: str,
        *,
        network_backend: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self.destination = destination
        self.backend = PinnedNetworkBackend(
            original_hostname=destination.hostname,
            approved_address=approved_address,
            delegate=network_backend,
        )
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=ssl.create_default_context(),
            max_connections=1,
            max_keepalive_connections=0,
            http1=True,
            http2=False,
            retries=0,
            network_backend=self.backend,
        )

    async def __aenter__(self) -> Self:
        await self._pool.__aenter__()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None = None,
        exc_value: BaseException | None = None,
        traceback: TracebackType | None = None,
    ) -> None:
        await self._pool.__aexit__(exc_type, exc_value, traceback)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        if request.url.host.casefold().rstrip(".") != self.destination.hostname:
            raise httpx.ConnectError(
                "request does not match the pinned destination", request=request
            )
        core_request = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=request.stream,
            extensions=request.extensions,
        )
        try:
            response = await self._pool.handle_async_request(core_request)
        except Exception as error:
            for source, target in _EXCEPTION_MAP:
                if isinstance(error, source):
                    raise target(str(error), request=request) from error
            raise
        return httpx.Response(
            status_code=response.status,
            headers=response.headers,
            stream=_CoreResponseStream(response.stream),
            extensions=response.extensions,
            request=request,
        )

    async def aclose(self) -> None:
        await self._pool.aclose()


class PinnedPublicHttpClient:
    def __init__(
        self,
        *,
        resolver: DnsResolver,
        timeout_seconds: float,
        network_backend: httpcore.AsyncNetworkBackend | None = None,
        distributed_limiter: DistributedRateLimiter | None = None,
        minimum_interval_seconds: float = 1,
        host_policy_check: Callable[[str, str, int], Awaitable[None]] | None = None,
    ) -> None:
        self._resolver = resolver
        self._timeout = httpx.Timeout(timeout_seconds)
        self._network_backend = network_backend
        self._distributed_limiter = distributed_limiter
        self._minimum_interval_seconds = minimum_interval_seconds
        self._host_policy_check = host_policy_check

    async def request(
        self,
        url: str,
        *,
        headers: Mapping[str, str],
        max_bytes: int,
    ) -> PinnedHttpResponse:
        canonical_url = canonicalize_url(url)
        parsed_url = httpx.URL(canonical_url)
        hostname = parsed_url.host.casefold().rstrip(".")
        port = parsed_url.port or (443 if parsed_url.scheme == "https" else 80)
        if self._host_policy_check is not None:
            await self._host_policy_check(hostname, parsed_url.scheme, port)
        destination = await resolve_public_url(canonical_url, self._resolver)
        if self._distributed_limiter is not None:
            await self._distributed_limiter.wait(
                "HOST", destination.hostname, self._minimum_interval_seconds
            )
        last_error: httpx.RequestError | None = None
        for address in destination.addresses:
            transport = PinnedAsyncTransport(
                destination,
                address,
                network_backend=self._network_backend,
            )
            try:
                async with httpx.AsyncClient(
                    transport=transport,
                    timeout=self._timeout,
                    follow_redirects=False,
                    trust_env=False,
                ) as client:
                    async with client.stream("GET", destination.url, headers=headers) as response:
                        length = response.headers.get("content-length")
                        if length and int(length) > max_bytes:
                            raise ResponseLimitExceededError(
                                "response exceeds configured size limit"
                            )
                        body = bytearray()
                        async for chunk in response.aiter_bytes():
                            body.extend(chunk)
                            if len(body) > max_bytes:
                                raise ResponseLimitExceededError(
                                    "response exceeds configured size limit"
                                )
                        return PinnedHttpResponse(
                            status_code=response.status_code,
                            headers=response.headers,
                            content=bytes(body),
                            url=str(response.url),
                        )
            except (httpx.ConnectError, httpx.ConnectTimeout) as error:
                last_error = error
        if last_error is not None:
            raise last_error
        raise httpx.ConnectError("validated destination had no connectable address")
