import email.utils
import ipaddress
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, Self
from urllib.parse import urlsplit, urlunsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from recruitintel_collectors.infrastructure.rate_limit import DistributedRateLimiter

from .enums import SearchProviderCostCategory, SearchResultKind
from .models import (
    SearchBatch,
    SearchRequest,
    SearchResult,
    SearchResultMetadata,
)
from .urls import UnsafeUrlError, canonicalize_url

YOU_SEARCH_URL = "https://api.you.com/v1/search"
YOU_SEARCH_HOST = "api.you.com"
YOU_SEARCH_COST_PER_CALL_MICROS = 5_000
SEARXNG_DEFAULT_DAILY_CALLS = 1_000


class SearchProviderError(RuntimeError):
    code = "SEARCH_PROVIDER_ERROR"


class SearchProviderRetryableError(SearchProviderError):
    code = "SEARCH_PROVIDER_UNAVAILABLE"


class SearchProviderRateLimitedError(SearchProviderError):
    code = "SEARCH_PROVIDER_RATE_LIMITED"

    def __init__(self, retry_after_seconds: int | None = None) -> None:
        super().__init__("search provider requested durable backoff")
        self.retry_after_seconds = retry_after_seconds


class SearchProviderAuthRequiredError(SearchProviderError):
    code = "SEARCH_PROVIDER_AUTH_REQUIRED"


class SearchProviderPermanentError(SearchProviderError):
    def __init__(self, code: str) -> None:
        super().__init__("search provider rejected the request")
        self.code = code


class SearchProviderResponseError(SearchProviderPermanentError):
    def __init__(self, code: str = "SEARCH_PROVIDER_INVALID_RESPONSE") -> None:
        super().__init__(code)


class SearchProviderResponseTooLargeError(SearchProviderPermanentError):
    def __init__(self) -> None:
        super().__init__("SEARCH_PROVIDER_RESPONSE_TOO_LARGE")


class SearchProviderBudgetExceededError(SearchProviderRateLimitedError):
    code = "SEARCH_PROVIDER_BUDGET_EXHAUSTED"

    def __init__(self, retry_after_seconds: int, *, period: str) -> None:
        super().__init__(retry_after_seconds)
        self.period = period


class SearchProviderCostBlockedError(SearchProviderError, PermissionError):
    code = "SEARCH_PROVIDER_ZERO_COST_BLOCKED"


class SearchProvider(Protocol):
    @property
    def name(self) -> str: ...

    async def search(self, request: SearchRequest) -> SearchBatch: ...


class SearchUsageBudget(Protocol):
    async def reserve(
        self,
        *,
        provider: str,
        credential_slot: str,
        provider_calls: int,
        estimated_cost_micros: int,
        paid_spend_micros: int,
    ) -> None: ...


class StaticSearchProvider:
    """Credential-free provider used only with local fixtures and deterministic tests."""

    def __init__(self, results: Mapping[str, Sequence[SearchResult]]) -> None:
        self._results = {query: tuple(values) for query, values in results.items()}

    @property
    def name(self) -> str:
        return "static"

    async def search(self, request: SearchRequest) -> SearchBatch:
        results: list[SearchResult] = []
        seen: set[str] = set()
        truncated = False
        for item in self._results.get(request.query, ()):
            try:
                canonical = _canonical_result_url(item.url)
            except UnsafeUrlError:
                continue
            if canonical in seen:
                continue
            if len(results) >= request.max_results:
                truncated = True
                break
            seen.add(canonical)
            results.append(item.model_copy(update={"url": canonical, "rank": len(results) + 1}))
        return SearchBatch(
            results=tuple(results),
            provider_calls=0,
            cost_units=0,
            estimated_cost_micros=0,
            truncated=truncated,
        )


class JsonFileSearchProvider(StaticSearchProvider):
    def __init__(self, path: Path) -> None:
        raw: Any = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("static search result file must contain a JSON object")
        adapter = TypeAdapter(list[SearchResult])
        parsed = {str(query): adapter.validate_python(results) for query, results in raw.items()}
        super().__init__(parsed)


class SearchProviderDescriptor(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str = Field(pattern=r"^[a-z0-9_-]+$")
    production_capable: bool
    production_enabled: bool = False
    official_api: bool
    api_hosts: tuple[str, ...] = ()
    credential_environment_names: tuple[str, ...] = ()
    minimum_interval_seconds: int = Field(ge=0)
    maximum_daily_queries: int = Field(ge=0)
    cost_metadata: dict[str, int | str | bool] = Field(default_factory=dict)
    cost_category: SearchProviderCostCategory
    zero_cost_eligible: bool
    terms_status: str = Field(pattern=r"^(DEVELOPMENT_ONLY|REVIEW_REQUIRED|REVIEWED)$")

    def assert_production_enabled(self) -> None:
        if not self.production_capable or not self.production_enabled:
            raise PermissionError("search provider is not enabled for production")
        if self.terms_status != "REVIEWED":
            raise PermissionError("search provider terms are not reviewed")


STATIC_SEARCH_DESCRIPTOR = SearchProviderDescriptor(
    name="static",
    production_capable=False,
    official_api=False,
    minimum_interval_seconds=0,
    maximum_daily_queries=0,
    cost_metadata={"billable": False},
    cost_category=SearchProviderCostCategory.FREE,
    zero_cost_eligible=True,
    terms_status="DEVELOPMENT_ONLY",
)

YOU_SEARCH_DESCRIPTOR = SearchProviderDescriptor(
    name="you",
    production_capable=True,
    official_api=True,
    api_hosts=(YOU_SEARCH_HOST,),
    credential_environment_names=("YDC_API_KEY",),
    minimum_interval_seconds=1,
    maximum_daily_queries=200,
    cost_metadata={
        "billable": True,
        "currency": "USD",
        "estimated_cost_per_call_micros": YOU_SEARCH_COST_PER_CALL_MICROS,
    },
    cost_category=SearchProviderCostCategory.PAID,
    zero_cost_eligible=False,
    terms_status="REVIEW_REQUIRED",
)

SEARXNG_SEARCH_DESCRIPTOR = SearchProviderDescriptor(
    name="searxng",
    production_capable=True,
    official_api=True,
    credential_environment_names=(),
    minimum_interval_seconds=1,
    maximum_daily_queries=SEARXNG_DEFAULT_DAILY_CALLS,
    cost_metadata={"billable": False, "operator_hosted": True},
    cost_category=SearchProviderCostCategory.FREE,
    zero_cost_eligible=True,
    terms_status="REVIEW_REQUIRED",
)


class SearchProviderRegistry:
    def __init__(
        self,
        providers: Sequence[SearchProvider],
        descriptors: Sequence[SearchProviderDescriptor] | None = None,
        *,
        zero_cost_mode: bool = True,
    ) -> None:
        self._providers = {provider.name: provider for provider in providers}
        values = tuple(descriptors) if descriptors is not None else (STATIC_SEARCH_DESCRIPTOR,)
        self._descriptors = {descriptor.name: descriptor for descriptor in values}
        if len(self._providers) != len(providers) or len(self._descriptors) != len(values):
            raise ValueError("search provider names and descriptors must be unique")
        if set(self._providers) != set(self._descriptors):
            raise ValueError("every search provider requires exactly one reviewed descriptor")
        self._zero_cost_mode = zero_cost_mode

    def get(self, name: str) -> SearchProvider:
        descriptor = self.descriptor(name)
        if self._zero_cost_mode and not descriptor.zero_cost_eligible:
            raise SearchProviderCostBlockedError(
                "paid search providers are disabled while zero-cost mode is active"
            )
        try:
            return self._providers[name]
        except KeyError as exc:
            raise KeyError(f"search provider {name!r} is not configured") from exc

    def descriptor(self, name: str) -> SearchProviderDescriptor:
        try:
            return self._descriptors[name]
        except KeyError as exc:
            raise KeyError(f"search provider descriptor {name!r} is not configured") from exc

    def get_production(self, name: str) -> SearchProvider:
        self.descriptor(name).assert_production_enabled()
        return self.get(name)


def _retry_after_seconds(headers: httpx.Headers) -> int | None:
    value = headers.get("Retry-After")
    if not value:
        return None
    try:
        return max(0, min(int(float(value)), 604_800))
    except ValueError:
        try:
            retry_at = email.utils.parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        return max(0, min(int((retry_at - datetime.now(UTC)).total_seconds()), 604_800))


def _quota_reset_at(headers: httpx.Headers) -> datetime | None:
    value = headers.get("X-RateLimit-Reset") or headers.get("RateLimit-Reset")
    if not value:
        return None
    try:
        parsed = datetime.fromtimestamp(float(value), tz=UTC)
    except (ValueError, OverflowError, OSError):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _quota_remaining(headers: httpx.Headers) -> int | None:
    value = headers.get("X-RateLimit-Remaining") or headers.get("RateLimit-Remaining")
    if value is None:
        return None
    try:
        return max(0, int(value))
    except ValueError:
        return None


def _canonical_result_url(value: str) -> str:
    canonical = canonicalize_url(value)
    hostname = urlsplit(canonical).hostname
    if hostname is None:
        raise UnsafeUrlError("search result requires a hostname")
    normalized = hostname.casefold().rstrip(".")
    if normalized == "localhost" or normalized.endswith(".localhost"):
        raise UnsafeUrlError("localhost search results are blocked")
    try:
        literal = ipaddress.ip_address(normalized)
    except ValueError:
        return canonical
    if not literal.is_global:
        raise UnsafeUrlError("private or non-routable search results are blocked")
    return canonical


def _published_at(value: object) -> datetime | None:
    if not isinstance(value, str) or len(value) > 100:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _bounded_text(value: object, maximum: int) -> str:
    return value.strip()[:maximum] if isinstance(value, str) else ""


def _result_snippet(record: Mapping[str, object]) -> str:
    snippets = record.get("snippets")
    if isinstance(snippets, list):
        values = [item.strip() for item in snippets if isinstance(item, str) and item.strip()]
        if values:
            return " … ".join(values)[:2000]
    return _bounded_text(record.get("description"), 2000)


def _parse_result(
    value: object,
    *,
    kind: SearchResultKind,
    page_offset: int,
    section_rank: int,
) -> SearchResult | None:
    if not isinstance(value, Mapping):
        return None
    url = value.get("url")
    if not isinstance(url, str):
        return None
    try:
        canonical = _canonical_result_url(url)
        return SearchResult(
            url=canonical,
            title=_bounded_text(value.get("title"), 500),
            snippet=_result_snippet(value),
            rank=1,
            result_kind=kind,
            published_at=_published_at(value.get("page_age")),
            metadata=SearchResultMetadata(
                page_offset=page_offset,
                section_rank=section_rank,
            ),
        )
    except (UnsafeUrlError, ValidationError):
        return None


def _section(payload: Mapping[str, object], name: str) -> list[object]:
    value = payload.get(name, [])
    if not isinstance(value, list):
        raise SearchProviderResponseError()
    return value


def _merge_sections(
    web: list[object], news: list[object]
) -> list[tuple[object, SearchResultKind, int]]:
    merged: list[tuple[object, SearchResultKind, int]] = []
    for index in range(max(len(web), len(news))):
        if index < len(web):
            merged.append((web[index], SearchResultKind.WEB, index + 1))
        if index < len(news):
            merged.append((news[index], SearchResultKind.NEWS, index + 1))
    return merged


class YouSearchProvider:
    """Offline-testable You.com snippets adapter; production activation is Gate 7.1B."""

    def __init__(
        self,
        *,
        api_key: str,
        budget: SearchUsageBudget,
        credential_slot: str = "default",
        user_agent: str = "RecruitIntel/0.1",
        timeout_seconds: float = 20,
        max_response_bytes: int = 1_000_000,
        page_size: int = 100,
        transport: httpx.AsyncBaseTransport | None = None,
        distributed_limiter: DistributedRateLimiter | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("You.com API key is required")
        if not credential_slot or len(credential_slot) > 100:
            raise ValueError("credential slot must be a short non-empty label")
        if not 1 <= page_size <= 100:
            raise ValueError("page size must be between 1 and 100")
        if max_response_bytes < 1:
            raise ValueError("response size limit must be positive")
        self._budget = budget
        self._credential_slot = credential_slot
        self._max_response_bytes = max_response_bytes
        self._page_size = page_size
        self._distributed_limiter = distributed_limiter
        self._client = httpx.AsyncClient(
            headers={
                "User-Agent": user_agent,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "X-API-Key": api_key,
            },
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            transport=transport,
        )

    @property
    def name(self) -> str:
        return "you"

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    def _payload(self, request: SearchRequest, *, count: int, offset: int) -> dict[str, object]:
        payload: dict[str, object] = {
            "query": request.query,
            "count": count,
            "offset": offset,
            "safesearch": "moderate",
        }
        if request.country_code:
            payload["country"] = request.country_code
        if request.language:
            payload["language"] = request.language
        if request.freshness:
            payload["freshness"] = request.freshness
        if request.include_domains:
            payload["include_domains"] = list(request.include_domains)
        if request.exclude_domains:
            payload["exclude_domains"] = list(request.exclude_domains)
        return payload

    async def _request_page(
        self, request: SearchRequest, *, count: int, offset: int
    ) -> tuple[Mapping[str, object], httpx.Headers]:
        if self._distributed_limiter is not None:
            await self._distributed_limiter.wait("PROVIDER", f"you:{self._credential_slot}", 1)
        await self._budget.reserve(
            provider=self.name,
            credential_slot=self._credential_slot,
            provider_calls=1,
            estimated_cost_micros=YOU_SEARCH_COST_PER_CALL_MICROS,
            paid_spend_micros=YOU_SEARCH_COST_PER_CALL_MICROS,
        )
        try:
            async with self._client.stream(
                "POST",
                YOU_SEARCH_URL,
                json=self._payload(request, count=count, offset=offset),
            ) as response:
                if response.is_redirect:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_REDIRECT_REJECTED")
                if response.status_code == 429:
                    raise SearchProviderRateLimitedError(_retry_after_seconds(response.headers))
                if response.status_code == 401:
                    raise SearchProviderAuthRequiredError("search provider authorization failed")
                if response.status_code == 402:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_QUOTA_EXHAUSTED")
                if response.status_code == 403:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_FORBIDDEN")
                if response.status_code == 422:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_INVALID_REQUEST")
                if response.status_code in {408, 425, 500, 502, 503, 504}:
                    raise SearchProviderRetryableError("search provider is unavailable")
                if response.status_code != 200:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_UNEXPECTED_STATUS")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
                if content_type != "application/json":
                    raise SearchProviderResponseError("SEARCH_PROVIDER_UNEXPECTED_CONTENT_TYPE")
                length = response.headers.get("content-length")
                if length:
                    try:
                        declared_size = int(length)
                    except ValueError as exc:
                        raise SearchProviderResponseError() from exc
                    if declared_size > self._max_response_bytes:
                        raise SearchProviderResponseTooLargeError()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > self._max_response_bytes:
                        raise SearchProviderResponseTooLargeError()
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise SearchProviderRetryableError("search provider transport failed") from exc
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise SearchProviderResponseError() from exc
        if not isinstance(payload, Mapping):
            raise SearchProviderResponseError()
        results = payload.get("results")
        if not isinstance(results, Mapping):
            raise SearchProviderResponseError()
        return results, response.headers

    async def search(self, request: SearchRequest) -> SearchBatch:
        collected: list[SearchResult] = []
        seen: set[str] = set()
        provider_calls = 0
        quota_remaining: int | None = None
        quota_reset_at: datetime | None = None
        truncated = False

        for offset in range(10):
            remaining = request.max_results - len(collected)
            if remaining <= 0:
                truncated = True
                break
            count = min(self._page_size, remaining)
            payload, headers = await self._request_page(
                request,
                count=count,
                offset=offset,
            )
            provider_calls += 1
            quota_remaining = _quota_remaining(headers)
            quota_reset_at = _quota_reset_at(headers)
            web = _section(payload, "web")
            news = _section(payload, "news")
            merged = _merge_sections(web, news)
            for raw, kind, section_rank in merged:
                result = _parse_result(
                    raw,
                    kind=kind,
                    page_offset=offset,
                    section_rank=section_rank,
                )
                if result is None or result.url in seen:
                    continue
                if len(collected) >= request.max_results:
                    truncated = True
                    break
                seen.add(result.url)
                collected.append(result.model_copy(update={"rank": len(collected) + 1}))
            if len(collected) >= request.max_results:
                truncated = truncated or len(web) >= count or len(news) >= count
                break
            if len(web) < count and len(news) < count:
                break
            if offset == 9:
                truncated = True

        return SearchBatch(
            results=tuple(collected),
            provider_calls=provider_calls,
            cost_units=provider_calls,
            estimated_cost_micros=provider_calls * YOU_SEARCH_COST_PER_CALL_MICROS,
            paid_spend_micros=provider_calls * YOU_SEARCH_COST_PER_CALL_MICROS,
            quota_remaining=quota_remaining,
            quota_reset_at=quota_reset_at,
            truncated=truncated,
        )


def _searxng_search_url(base_url: str) -> str:
    if len(base_url) > 2048:
        raise ValueError("SearXNG base URL is too long")
    parsed = urlsplit(base_url.strip())
    hostname = (parsed.hostname or "").casefold().rstrip(".")
    if parsed.scheme not in {"http", "https"} or not hostname:
        raise ValueError("SearXNG base URL must be HTTP or HTTPS")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("SearXNG base URL contains unsupported components")
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError("SearXNG base URL port is invalid") from exc
    del port
    if parsed.scheme == "http":
        try:
            address = ipaddress.ip_address(hostname)
        except ValueError:
            local_http = (
                hostname == "localhost" or hostname.endswith(".localhost") or "." not in hostname
            )
        else:
            local_http = address.is_private or address.is_loopback
        if not local_http:
            raise ValueError("remote SearXNG instances must use HTTPS")
    path = parsed.path.rstrip("/") + "/search"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


class SearXNGProvider:
    """Optional adapter for an operator-controlled, separately reviewed SearXNG instance."""

    def __init__(
        self,
        *,
        base_url: str,
        budget: SearchUsageBudget,
        credential_slot: str = "local",
        user_agent: str = "RecruitIntel/0.1",
        timeout_seconds: float = 20,
        max_response_bytes: int = 1_000_000,
        page_size: int = 20,
        transport: httpx.AsyncBaseTransport | None = None,
        distributed_limiter: DistributedRateLimiter | None = None,
    ) -> None:
        if not credential_slot or len(credential_slot) > 100:
            raise ValueError("credential slot must be a short non-empty label")
        if not 1 <= page_size <= 100:
            raise ValueError("page size must be between 1 and 100")
        self._search_url = _searxng_search_url(base_url)
        self._budget = budget
        self._credential_slot = credential_slot
        self._max_response_bytes = max_response_bytes
        self._page_size = page_size
        self._distributed_limiter = distributed_limiter
        self._client = httpx.AsyncClient(
            headers={"User-Agent": user_agent, "Accept": "application/json"},
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
            trust_env=False,
            limits=httpx.Limits(max_connections=2, max_keepalive_connections=1),
            transport=transport,
        )

    @property
    def name(self) -> str:
        return "searxng"

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request_page(self, request: SearchRequest, *, count: int, page: int) -> list[object]:
        if request.include_domains or request.exclude_domains:
            raise SearchProviderPermanentError("SEARCH_PROVIDER_UNSUPPORTED_DOMAIN_FILTER")
        if request.country_code:
            raise SearchProviderPermanentError("SEARCH_PROVIDER_UNSUPPORTED_COUNTRY_FILTER")
        if request.freshness and "to" in request.freshness:
            raise SearchProviderPermanentError("SEARCH_PROVIDER_UNSUPPORTED_FRESHNESS")
        if self._distributed_limiter is not None:
            await self._distributed_limiter.wait("PROVIDER", f"searxng:{self._credential_slot}", 1)
        await self._budget.reserve(
            provider=self.name,
            credential_slot=self._credential_slot,
            provider_calls=1,
            estimated_cost_micros=0,
            paid_spend_micros=0,
        )
        params: dict[str, str | int] = {
            "q": request.query,
            "format": "json",
            "pageno": page,
            "safesearch": 2,
        }
        if request.language:
            params["language"] = request.language
        if request.freshness:
            params["time_range"] = request.freshness
        try:
            async with self._client.stream("GET", self._search_url, params=params) as response:
                if response.is_redirect:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_REDIRECT_REJECTED")
                if response.status_code == 429:
                    raise SearchProviderRateLimitedError(_retry_after_seconds(response.headers))
                if response.status_code == 401:
                    raise SearchProviderAuthRequiredError("SearXNG proxy authorization failed")
                if response.status_code == 403:
                    raise SearchProviderPermanentError("SEARXNG_API_NOT_ENABLED")
                if response.status_code == 422:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_INVALID_REQUEST")
                if response.status_code in {408, 425, 500, 502, 503, 504}:
                    raise SearchProviderRetryableError("SearXNG instance is unavailable")
                if response.status_code != 200:
                    raise SearchProviderPermanentError("SEARCH_PROVIDER_UNEXPECTED_STATUS")
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip()
                if content_type != "application/json":
                    raise SearchProviderResponseError("SEARCH_PROVIDER_UNEXPECTED_CONTENT_TYPE")
                declared = response.headers.get("content-length")
                if declared:
                    try:
                        if int(declared) > self._max_response_bytes:
                            raise SearchProviderResponseTooLargeError()
                    except ValueError as exc:
                        raise SearchProviderResponseError() from exc
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > self._max_response_bytes:
                        raise SearchProviderResponseTooLargeError()
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            raise SearchProviderRetryableError("SearXNG transport failed") from exc
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise SearchProviderResponseError() from exc
        if not isinstance(payload, Mapping):
            raise SearchProviderResponseError()
        results = payload.get("results")
        if not isinstance(results, list):
            raise SearchProviderResponseError()
        return list(results[:count])

    async def search(self, request: SearchRequest) -> SearchBatch:
        collected: list[SearchResult] = []
        seen: set[str] = set()
        provider_calls = 0
        truncated = False
        for page in range(1, 11):
            remaining = request.max_results - len(collected)
            if remaining <= 0:
                truncated = True
                break
            count = min(self._page_size, remaining)
            records = await self._request_page(request, count=count, page=page)
            provider_calls += 1
            for section_rank, value in enumerate(records, start=1):
                if not isinstance(value, Mapping):
                    continue
                url = value.get("url")
                if not isinstance(url, str):
                    continue
                try:
                    canonical = _canonical_result_url(url)
                    kind = (
                        SearchResultKind.NEWS
                        if str(value.get("category", "")).casefold() == "news"
                        else SearchResultKind.WEB
                    )
                    parsed = SearchResult(
                        url=canonical,
                        title=_bounded_text(value.get("title"), 500),
                        snippet=_bounded_text(value.get("content"), 2000),
                        rank=1,
                        result_kind=kind,
                        published_at=_published_at(
                            value.get("publishedDate") or value.get("published_at")
                        ),
                        metadata=SearchResultMetadata(
                            page_offset=page - 1, section_rank=section_rank
                        ),
                    )
                except (UnsafeUrlError, ValidationError):
                    continue
                if parsed.url in seen:
                    continue
                seen.add(parsed.url)
                collected.append(parsed.model_copy(update={"rank": len(collected) + 1}))
                if len(collected) >= request.max_results:
                    truncated = len(records) >= count
                    break
            if len(collected) >= request.max_results or len(records) < count:
                break
            if page == 10:
                truncated = True
        return SearchBatch(
            results=tuple(collected),
            provider_calls=provider_calls,
            cost_units=provider_calls,
            estimated_cost_micros=0,
            paid_spend_micros=0,
            truncated=truncated,
        )
