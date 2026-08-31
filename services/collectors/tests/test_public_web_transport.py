import ssl
from collections.abc import Iterable
from typing import Any

import httpcore
import pytest
from recruitintel_collectors.public_web.fetcher import CachedRobotsPolicy, SafePublicWebFetcher
from recruitintel_collectors.public_web.transport import PinnedPublicHttpClient
from recruitintel_collectors.public_web.urls import UnsafeUrlError


class SequencedResolver:
    def __init__(self, answers: dict[str, list[tuple[str, ...]]]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, int]] = []

    async def resolve(self, hostname: str, port: int) -> tuple[str, ...]:
        self.calls.append((hostname, port))
        values = self.answers[hostname]
        if len(values) > 1:
            return values.pop(0)
        return values[0]


class RecordingStream(httpcore.AsyncNetworkStream):
    def __init__(self, response: bytes) -> None:
        self.response = response
        self.writes = bytearray()
        self.server_hostname: str | None = None
        self.ssl_context: ssl.SSLContext | None = None
        self.closed = False

    async def read(
        self,
        max_bytes: int,
        timeout: float | None = None,  # noqa: ASYNC109
    ) -> bytes:
        del timeout
        result, self.response = self.response[:max_bytes], self.response[max_bytes:]
        return result

    async def write(
        self,
        buffer: bytes,
        timeout: float | None = None,  # noqa: ASYNC109
    ) -> None:
        del timeout
        self.writes.extend(buffer)

    async def aclose(self) -> None:
        self.closed = True

    async def start_tls(
        self,
        ssl_context: ssl.SSLContext,
        server_hostname: str | None = None,
        timeout: float | None = None,  # noqa: ASYNC109
    ) -> httpcore.AsyncNetworkStream:
        del timeout
        self.ssl_context = ssl_context
        self.server_hostname = server_hostname
        return self

    def get_extra_info(self, info: str) -> Any:
        del info
        return None


class RecordingBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, response: bytes) -> None:
        self.response = response
        self.connections: list[tuple[str, int]] = []
        self.streams: list[RecordingStream] = []

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del timeout, local_address, socket_options
        self.connections.append((host, port))
        stream = RecordingStream(self.response)
        self.streams.append(stream)
        return stream

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del path, timeout, socket_options
        raise AssertionError("public transport must never use a Unix socket")

    async def sleep(self, seconds: float) -> None:
        del seconds


class AllowRobots:
    async def allowed(self, url: str, user_agent: str) -> bool:
        del url, user_agent
        return True


@pytest.mark.asyncio
async def test_transport_dials_validated_ip_but_preserves_host_and_tls_identity() -> None:
    backend = RecordingBackend(
        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
    )
    resolver = SequencedResolver({"example.com": [("93.184.216.34",)]})
    client = PinnedPublicHttpClient(resolver=resolver, timeout_seconds=2, network_backend=backend)

    response = await client.request(
        "https://example.com/jobs",
        headers={"User-Agent": "RecruitIntelTest/1"},
        max_bytes=10,
    )

    assert response.content == b"ok"
    assert resolver.calls == [("example.com", 443)]
    assert backend.connections == [("93.184.216.34", 443)]
    assert backend.streams[0].server_hostname == "example.com"
    assert backend.streams[0].ssl_context is not None
    assert backend.streams[0].ssl_context.check_hostname is True
    assert b"Host: example.com\r\n" in backend.streams[0].writes


@pytest.mark.asyncio
async def test_transport_cannot_be_rebound_after_validation() -> None:
    backend = RecordingBackend(
        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
    )
    resolver = SequencedResolver({"example.com": [("93.184.216.34",), ("127.0.0.1",)]})
    client = PinnedPublicHttpClient(resolver=resolver, timeout_seconds=2, network_backend=backend)

    await client.request("https://example.com/", headers={}, max_bytes=10)

    assert resolver.calls == [("example.com", 443)]
    assert backend.connections == [("93.184.216.34", 443)]


@pytest.mark.asyncio
async def test_transport_rejects_mixed_and_ipv6_special_resolution_before_connecting() -> None:
    backend = RecordingBackend(b"")
    for addresses in [
        ("93.184.216.34", "10.0.0.4"),
        ("::ffff:127.0.0.1",),
        ("2002:7f00:1::",),
        ("fe80::1",),
    ]:
        client = PinnedPublicHttpClient(
            resolver=SequencedResolver({"example.com": [addresses]}),
            timeout_seconds=2,
            network_backend=backend,
        )
        with pytest.raises(UnsafeUrlError):
            await client.request("https://example.com/", headers={}, max_bytes=10)
    assert backend.connections == []


@pytest.mark.asyncio
async def test_transport_checks_source_host_policy_before_dns_or_connection() -> None:
    backend = RecordingBackend(b"")
    resolver = SequencedResolver({"example.com": [("93.184.216.34",)]})

    async def blocked(hostname: str, scheme: str, port: int) -> None:
        assert hostname == "example.com"
        assert (scheme, port) == ("https", 443)
        raise PermissionError("source hostname is not approved")

    client = PinnedPublicHttpClient(
        resolver=resolver,
        timeout_seconds=2,
        network_backend=backend,
        host_policy_check=blocked,
    )
    with pytest.raises(PermissionError):
        await client.request("https://example.com/", headers={}, max_bytes=10)
    assert resolver.calls == []
    assert backend.connections == []


@pytest.mark.asyncio
async def test_robots_fetch_uses_the_same_pinned_transport() -> None:
    backend = RecordingBackend(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n"
        b"User-agent: *\nDisallow: /private\n"
    )
    resolver = SequencedResolver({"example.com": [("93.184.216.34",)]})
    requester = PinnedPublicHttpClient(
        resolver=resolver, timeout_seconds=2, network_backend=backend
    )
    policy = CachedRobotsPolicy(requester=requester)

    assert not await policy.allowed("http://example.com/private", "RecruitIntelTest/1")
    assert backend.connections == [("93.184.216.34", 80)]
    assert b"GET /robots.txt HTTP/1.1\r\n" in backend.streams[0].writes
    assert b"Host: example.com\r\n" in backend.streams[0].writes


@pytest.mark.asyncio
async def test_redirect_target_is_independently_resolved_and_private_target_is_never_dialed() -> (
    None
):
    backend = RecordingBackend(
        b"HTTP/1.1 302 Found\r\nLocation: http://private.test/admin\r\n"
        b"Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    resolver = SequencedResolver(
        {
            "example.com": [("93.184.216.34",)],
            "private.test": [("127.0.0.1",)],
        }
    )
    requester = PinnedPublicHttpClient(
        resolver=resolver, timeout_seconds=2, network_backend=backend
    )
    async with SafePublicWebFetcher(
        user_agent="RecruitIntelTest/1",
        requester=requester,
        robots_policy=AllowRobots(),
        requests_per_second=1000,
    ) as fetcher:
        with pytest.raises(UnsafeUrlError):
            await fetcher.fetch("http://example.com/start")
    assert backend.connections == [("93.184.216.34", 80)]
