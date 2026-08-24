import asyncio
import ipaddress
import posixpath
import socket
from collections.abc import Sequence
from dataclasses import dataclass
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
    if port is not None and port not in {80, 443}:
        raise UnsafeUrlError("only standard HTTP and HTTPS ports are supported")
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
    if not address.is_global:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None and not address.ipv4_mapped.is_global:
            return False
        if address.sixtofour is not None and not address.sixtofour.is_global:
            return False
        if address.teredo is not None:
            server, client = address.teredo
            if not server.is_global or not client.is_global:
                return False
        if address in ipaddress.ip_network("64:ff9b::/96"):
            return False
    return True


@dataclass(frozen=True, slots=True)
class ResolvedPublicUrl:
    url: str
    hostname: str
    port: int
    addresses: tuple[str, ...]


async def resolve_public_url(value: str, resolver: DnsResolver) -> ResolvedPublicUrl:
    canonical = canonicalize_url(value)
    parsed = urlsplit(canonical)
    hostname = parsed.hostname
    if hostname is None:
        raise UnsafeUrlError("URL requires a hostname")
    if hostname.lower() == "localhost" or hostname.lower().endswith(".localhost"):
        raise UnsafeUrlError("localhost destinations are blocked")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        literal = ipaddress.ip_address(hostname)
    except ValueError:
        literal = None
    addresses: tuple[str, ...]
    if literal is not None:
        if not _is_public_address(str(literal)):
            raise UnsafeUrlError("private or non-routable destinations are blocked")
        addresses = (str(literal),)
    else:
        addresses = tuple(dict.fromkeys(await resolver.resolve(hostname, port)))
        if not addresses:
            raise UnsafeUrlError("hostname did not resolve")
        if any(not _is_public_address(address) for address in addresses):
            raise UnsafeUrlError("hostname resolves to a private or non-routable destination")
    return ResolvedPublicUrl(
        url=canonical,
        hostname=hostname.casefold().rstrip("."),
        port=port,
        addresses=addresses,
    )


async def validate_public_url(value: str, resolver: DnsResolver) -> str:
    return (await resolve_public_url(value, resolver)).url
