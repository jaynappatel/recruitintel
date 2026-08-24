import json
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from pydantic import ValidationError
from recruitintel_collectors.orchestration.enums import FailureClassification
from recruitintel_collectors.orchestration.failures import classify_failure
from recruitintel_collectors.public_web.enums import SearchResultKind
from recruitintel_collectors.public_web.models import SearchRequest, SearchResultMetadata
from recruitintel_collectors.public_web.search import (
    YOU_SEARCH_DESCRIPTOR,
    YOU_SEARCH_URL,
    SearchProviderAuthRequiredError,
    SearchProviderPermanentError,
    SearchProviderRateLimitedError,
    SearchProviderResponseError,
    SearchProviderResponseTooLargeError,
    SearchProviderRetryableError,
    YouSearchProvider,
)


class Budget:
    def __init__(self) -> None:
        self.reservations: list[dict[str, Any]] = []

    async def reserve(self, **values: Any) -> None:
        self.reservations.append(values)


class Limiter:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, float]] = []

    async def wait(self, scope_type: str, scope_key: str, minimum: float) -> None:
        self.calls.append((scope_type, scope_key, minimum))


def response_payload(
    *, web: list[object] | None = None, news: list[object] | None = None
) -> dict[str, object]:
    return {"results": {"web": web or [], "news": news or []}, "metadata": {"ignored": True}}


def result(url: str, title: str = "Result", *, age: str | None = None) -> dict[str, object]:
    value: dict[str, object] = {
        "url": url,
        "title": title,
        "description": "A bounded fallback description",
        "snippets": ["First snippet", "Second snippet"],
        "thumbnail_url": "https://images.example/private.jpg",
        "unexpected": "must not survive",
    }
    if age is not None:
        value["page_age"] = age
    return value


async def search_once(
    handler: httpx.MockTransport,
    *,
    request: SearchRequest | None = None,
    max_response_bytes: int = 1_000_000,
    page_size: int = 10,
    budget: Budget | None = None,
    limiter: Limiter | None = None,
):
    usage = budget or Budget()
    async with YouSearchProvider(
        api_key="synthetic-secret",
        budget=usage,
        transport=handler,
        max_response_bytes=max_response_bytes,
        page_size=page_size,
        distributed_limiter=limiter,
    ) as provider:
        batch = await provider.search(
            request or SearchRequest(query="software internship", max_results=10)
        )
    return batch, usage


@pytest.mark.asyncio
async def test_normal_result_uses_fixed_post_snippets_only_and_bounded_metadata() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            headers={
                "Content-Type": "application/json",
                "X-RateLimit-Remaining": "41",
                "X-RateLimit-Reset": "1798761600",
            },
            json=response_payload(
                web=[
                    result(
                        "https://example.com/jobs?utm_source=provider", age="2026-08-22T12:00:00Z"
                    )
                ]
            ),
            request=request,
        )

    batch, budget = await search_once(
        httpx.MockTransport(handler),
        request=SearchRequest(
            query=" software   internship ",
            max_results=10,
            country_code="US",
            language="en-US",
            freshness="month",
            include_domains=("EXAMPLE.com.",),
        ),
    )

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == YOU_SEARCH_URL
    assert request.headers["X-API-Key"] == "synthetic-secret"
    body = json.loads(request.content)
    assert body == {
        "query": "software internship",
        "count": 10,
        "offset": 0,
        "safesearch": "moderate",
        "country": "US",
        "language": "en-US",
        "freshness": "month",
        "include_domains": ["example.com"],
    }
    assert "extraction" not in body and "livecrawl" not in body and "research" not in body
    assert batch.provider_calls == batch.cost_units == 1
    assert batch.estimated_cost_micros == 5_000
    assert batch.quota_remaining == 41
    assert batch.quota_reset_at == datetime(2027, 1, 1, tzinfo=UTC)
    assert batch.results[0].url == "https://example.com/jobs"
    assert batch.results[0].snippet == "First snippet … Second snippet"
    assert batch.results[0].published_at == datetime(2026, 8, 22, 12, tzinfo=UTC)
    assert batch.results[0].metadata.model_dump(exclude_none=True) == {
        "page_offset": 0,
        "section_rank": 1,
    }
    assert budget.reservations == [
        {
            "provider": "you",
            "credential_slot": "default",
            "provider_calls": 1,
            "estimated_cost_micros": 5_000,
        }
    ]


@pytest.mark.asyncio
async def test_web_news_are_merged_deterministically_and_zero_results_are_valid() -> None:
    async def run(payload: object):
        return await search_once(
            httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    headers={"Content-Type": "application/json"},
                    json=payload,
                    request=request,
                )
            )
        )

    batch, _ = await run(
        response_payload(
            web=[result("https://example.com/web-1"), result("https://example.com/web-2")],
            news=[result("https://news.example.com/news-1")],
        )
    )
    assert [item.result_kind for item in batch.results] == [
        SearchResultKind.WEB,
        SearchResultKind.NEWS,
        SearchResultKind.WEB,
    ]
    assert [item.rank for item in batch.results] == [1, 2, 3]
    empty, _ = await run(response_payload())
    assert empty.results == ()


@pytest.mark.asyncio
async def test_pagination_duplicate_urls_and_max_result_termination() -> None:
    offsets: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        offset = json.loads(request.content)["offset"]
        offsets.append(offset)
        values = {
            0: [
                result("https://example.com/one?utm_source=a"),
                result("https://example.com/two"),
            ],
            1: [
                result("https://example.com/one?utm_medium=b"),
                result("https://example.com/three"),
            ],
            2: [result("https://example.com/four")],
        }[offset]
        return httpx.Response(
            200,
            headers={"Content-Type": "application/json"},
            json=response_payload(web=values),
            request=request,
        )

    batch, budget = await search_once(
        httpx.MockTransport(handler),
        request=SearchRequest(query="internships", max_results=4),
        page_size=2,
    )
    assert offsets == [0, 1, 2]
    assert [item.url for item in batch.results] == [
        "https://example.com/one",
        "https://example.com/two",
        "https://example.com/three",
        "https://example.com/four",
    ]
    assert batch.provider_calls == len(budget.reservations) == 3

    one_page, _ = await search_once(
        httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"Content-Type": "application/json"},
                json=response_payload(
                    web=[result("https://example.com/a"), result("https://example.com/b")],
                    news=[result("https://example.com/c")],
                ),
                request=request,
            )
        ),
        request=SearchRequest(query="internships", max_results=2),
        page_size=2,
    )
    assert len(one_page.results) == 2
    assert one_page.provider_calls == 1
    assert one_page.truncated


@pytest.mark.asyncio
async def test_malformed_records_and_unsafe_destinations_are_dropped() -> None:
    batch, _ = await search_once(
        httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"Content-Type": "application/json"},
                json=response_payload(
                    web=[
                        "not-an-object",
                        {"title": "missing URL"},
                        result("file:///etc/passwd"),
                        result("http://127.0.0.1/private"),
                        result("https://localhost/private"),
                        result("https://example.com/safe"),
                    ]
                ),
                request=request,
            )
        )
    )
    assert [item.url for item in batch.results] == ["https://example.com/safe"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "content_type", "exception"),
    [
        ({"results": []}, "application/json", SearchProviderResponseError),
        ({"results": {"web": {}, "news": []}}, "application/json", SearchProviderResponseError),
        (response_payload(), "text/html", SearchProviderResponseError),
    ],
)
async def test_malformed_response_and_unexpected_content(
    payload: object,
    content_type: str,
    exception: type[Exception],
) -> None:
    with pytest.raises(exception):
        await search_once(
            httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    headers={"Content-Type": content_type},
                    json=payload,
                    request=request,
                )
            )
        )


@pytest.mark.asyncio
async def test_oversized_response_is_rejected_without_persisting_raw_payload() -> None:
    with pytest.raises(SearchProviderResponseTooLargeError):
        await search_once(
            httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    headers={"Content-Type": "application/json", "Content-Length": "1000"},
                    content=b"{}",
                    request=request,
                )
            ),
            max_response_bytes=10,
        )


@pytest.mark.asyncio
async def test_provider_redirect_is_not_followed() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(
            302,
            headers={"Location": "https://attacker.example/search"},
            request=request,
        )

    with pytest.raises(SearchProviderPermanentError) as caught:
        await search_once(httpx.MockTransport(handler))
    assert caught.value.code == "SEARCH_PROVIDER_REDIRECT_REJECTED"
    assert calls == [YOU_SEARCH_URL]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "exception", "classification", "code"),
    [
        (
            429,
            SearchProviderRateLimitedError,
            FailureClassification.RATE_LIMITED,
            "SEARCH_PROVIDER_RATE_LIMITED",
        ),
        (
            402,
            SearchProviderPermanentError,
            FailureClassification.NON_RETRYABLE,
            "SEARCH_PROVIDER_QUOTA_EXHAUSTED",
        ),
        (
            401,
            SearchProviderAuthRequiredError,
            FailureClassification.AUTH_REQUIRED,
            "SEARCH_PROVIDER_AUTH_REQUIRED",
        ),
        (
            403,
            SearchProviderPermanentError,
            FailureClassification.NON_RETRYABLE,
            "SEARCH_PROVIDER_FORBIDDEN",
        ),
        (
            422,
            SearchProviderPermanentError,
            FailureClassification.NON_RETRYABLE,
            "SEARCH_PROVIDER_INVALID_REQUEST",
        ),
        (
            503,
            SearchProviderRetryableError,
            FailureClassification.RETRYABLE,
            "SEARCH_PROVIDER_UNAVAILABLE",
        ),
    ],
)
async def test_http_failures_map_to_durable_classifications(
    status: int,
    exception: type[Exception],
    classification: FailureClassification,
    code: str,
) -> None:
    budget = Budget()
    with pytest.raises(exception) as caught:
        await search_once(
            httpx.MockTransport(
                lambda request: httpx.Response(
                    status,
                    headers={"Retry-After": "120"},
                    request=request,
                )
            ),
            budget=budget,
        )
    failure = classify_failure(caught.value)
    assert failure.classification is classification
    assert failure.code == code
    if status == 429:
        assert failure.retry_after_seconds == 120
    assert len(budget.reservations) == 1


@pytest.mark.asyncio
async def test_timeout_keeps_reservation_redacts_secret_and_retry_is_idempotent() -> None:
    calls = 0
    budget = Budget()

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise httpx.ReadTimeout("synthetic-secret must not be surfaced", request=request)
        return httpx.Response(
            200,
            headers={"Content-Type": "application/json"},
            json=response_payload(web=[result("https://example.com/retry")]),
            request=request,
        )

    transport = httpx.MockTransport(handler)
    with pytest.raises(SearchProviderRetryableError) as caught:
        await search_once(transport, budget=budget)
    assert "synthetic-secret" not in str(caught.value)
    batch, _ = await search_once(transport, budget=budget)
    assert [item.url for item in batch.results] == ["https://example.com/retry"]
    assert len(budget.reservations) == 2


@pytest.mark.asyncio
async def test_provider_rate_cap_is_shared_by_provider_and_credential_slot() -> None:
    limiter = Limiter()
    await search_once(
        httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"Content-Type": "application/json"},
                json=response_payload(),
                request=request,
            )
        ),
        limiter=limiter,
    )
    assert limiter.calls == [("PROVIDER", "you:default", 1)]


def test_you_descriptor_remains_production_disabled_pending_review() -> None:
    assert YOU_SEARCH_DESCRIPTOR.production_capable
    assert not YOU_SEARCH_DESCRIPTOR.production_enabled
    assert YOU_SEARCH_DESCRIPTOR.terms_status == "REVIEW_REQUIRED"
    assert YOU_SEARCH_DESCRIPTOR.api_hosts == ("api.you.com",)
    with pytest.raises(PermissionError):
        YOU_SEARCH_DESCRIPTOR.assert_production_enabled()


def test_search_request_and_result_metadata_are_strictly_bounded() -> None:
    with pytest.raises(ValidationError):
        SearchRequest(
            query="internships",
            max_results=10,
            include_domains=("example.com",),
            exclude_domains=("other.example",),
        )
    with pytest.raises(ValidationError):
        SearchRequest(query="internships", max_results=101)
    with pytest.raises(ValidationError):
        SearchResultMetadata.model_validate({"provider_payload": "not allowed"})
