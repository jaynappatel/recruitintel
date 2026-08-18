import asyncio
import ipaddress
import posixpath
import socket
from collections.abc import Sequence
from typing import Protocol
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit


class UnsafeUrlError(ValueError):
    pass


_TRACKING_KEYS = {
    "dclid",
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "msclkid",
}


def canonicalize_url(value: str) -> str:
    if len(value) > 8192:
        raise UnsafeUrlError("URL exceeds the supported length")
    parsed = urlsplit(value.strip())
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        raise UnsafeUrlError("only HTTP and HTTPS URLs are supported")
    if parsed.username or parsed.password:
        raise UnsafeUrlError("URLs must not contain credentials")
    hostname = parsed.hostname
    if not hostname:
        raise UnsafeUrlError("URL requires a hostname")
    try:
        normalized_host = hostname.encode("idna").decode("ascii").lower().rstrip(".")
    except UnicodeError as exc:
        raise UnsafeUrlError("URL hostname is invalid") from exc
    try:
        port = parsed.port
    except ValueError as exc:
        raise UnsafeUrlError("URL port is invalid") from exc
    if port is not None and not 1 <= port <= 65535:
        raise UnsafeUrlError("URL port is invalid")
    port_suffix = ""
    if port is not None and not (
        (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    ):
        port_suffix = f":{port}"
    host_for_url = f"[{normalized_host}]" if ":" in normalized_host else normalized_host
    path = parsed.path or "/"
    normalized_path = posixpath.normpath(path)
    if not normalized_path.startswith("/"):
        normalized_path = f"/{normalized_path}"
    if path.endswith("/") and normalized_path != "/":
        normalized_path += "/"
    normalized_path = quote(normalized_path, safe="/%:@!$&'()*+,;=-._~")
    query_items = [
        (key, item)
        for key, item in parse_qsl(parsed.query, keep_blank_values=True)
        if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_KEYS
    ]
    query = urlencode(sorted(query_items), doseq=True)
    return urlunsplit((scheme, f"{host_for_url}{port_suffix}", normalized_path, query, ""))


class DnsResolver(Protocol):
    async def resolve(self, hostname: str, port: int) -> Sequence[str]: ...


class SystemDnsResolver:
    async def resolve(self, hostname: str, port: int) -> Sequence[str]:
        loop = asyncio.get_running_loop()
        rows = await loop.getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
        return tuple(sorted({str(row[4][0]) for row in rows}))


def _is_public_address(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return address.is_global


async def validate_public_url(value: str, resolver: DnsResolver) -> str:
    canonical = canonicalize_url(value)
    parsed = urlsplit(canonical)
    hostname = parsed.hostname
    if hostname is None:
        raise UnsafeUrlError("URL requires a hostname")
    if hostname.lower() == "localhost" or hostname.lower().endswith(".localhost"):
        raise UnsafeUrlError("localhost destinations are blocked")
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    if literal is not None:
        if not literal.is_global:
            raise UnsafeUrlError("private or non-routable destinations are blocked")
        return canonical
    addresses = await resolver.resolve(
        hostname, parsed.port or (443 if parsed.scheme == "https" else 80)
    )
    if not addresses:
        raise UnsafeUrlError("hostname did not resolve")
    if any(not _is_public_address(address) for address in addresses):
        raise UnsafeUrlError("hostname resolves to a private or non-routable destination")
    return canonical
