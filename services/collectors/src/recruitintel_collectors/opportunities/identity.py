import hashlib
from dataclasses import dataclass
from urllib.parse import urlsplit

from recruitintel_collectors.domain.normalization import normalize_url


@dataclass(frozen=True, slots=True)
class OpportunityIdentityKey:
    key_type: str
    key_hash: str
    provider: str | None
    safe_value_hint: str
    reason_code: str


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def provider_native_key(*, provider: str, board: str, external_id: str) -> OpportunityIdentityKey:
    value = f"v1:{provider.casefold()}:{board.strip().casefold()}:{external_id.strip()}"
    return OpportunityIdentityKey(
        key_type="PROVIDER_NATIVE_ID",
        key_hash=_hash(value),
        provider=provider.casefold(),
        safe_value_hint=f"{provider.casefold()}:{board[:80]}:{external_id[:80]}",
        reason_code="VALIDATED_PROVIDER_BOARD_NATIVE_ID",
    )


def official_application_url_key(
    url: str, *, validated_hosts: frozenset[str]
) -> OpportunityIdentityKey | None:
    canonical = normalize_url(url)
    hostname = (urlsplit(canonical).hostname or "").casefold().rstrip(".")
    allowed = any(hostname == host or hostname.endswith(f".{host}") for host in validated_hosts)
    if not allowed:
        return None
    return OpportunityIdentityKey(
        key_type="OFFICIAL_APPLICATION_URL",
        key_hash=_hash(f"v1:{canonical}"),
        provider=None,
        safe_value_hint=f"{hostname}{urlsplit(canonical).path}"[:200],
        reason_code="VALIDATED_CANONICAL_OFFICIAL_APPLICATION_URL",
    )
