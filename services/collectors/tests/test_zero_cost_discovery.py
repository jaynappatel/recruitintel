from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx
import pytest
from recruitintel_collectors.config import Settings
from recruitintel_collectors.public_web.direct_discovery import DirectSourceDiscovery
from recruitintel_collectors.public_web.enums import (
    SearchResultKind,
    SourceDiscoveryMethod,
    WebWorkStatus,
    WebWorkType,
)
from recruitintel_collectors.public_web.models import (
    CandidateConfig,
    CompanyWebConfig,
    FetchedDocument,
    KnownSourceCoverage,
    PublicWebWorkRequest,
    SearchQueryConfig,
    SearchRequest,
)
from recruitintel_collectors.public_web.runner import PublicWebWorker
from recruitintel_collectors.public_web.search import (
    SEARXNG_SEARCH_DESCRIPTOR,
    YOU_SEARCH_DESCRIPTOR,
    SearchProviderAuthRequiredError,
    SearchProviderCostBlockedError,
    SearchProviderPermanentError,
    SearchProviderRateLimitedError,
    SearchProviderRegistry,
    SearchProviderRetryableError,
    SearXNGProvider,
)

COMPANY_ID = UUID("c7100000-0000-0000-0000-000000000001")
SOURCE_ID = UUID("c7100000-0000-0000-0000-000000000002")
CANDIDATE_ID = UUID("c7100000-0000-0000-0000-000000000003")
REQUEST_ID = UUID("c7100000-0000-0000-0000-000000000004")
QUERY_ID = UUID("c7100000-0000-0000-0000-000000000005")
RUN_ID = UUID("c7100000-0000-0000-0000-000000000006")


def company(*, careers_url: str | None = None) -> CompanyWebConfig:
    return CompanyWebConfig(
        id=COMPANY_ID,
        canonical_name="Example",
        slug="example",
        website="https://example.com",
        careers_url=careers_url,
        domains=("example.com",),
    )


class Budget:
    def __init__(self) -> None:
        self.reservations: list[dict[str, Any]] = []

    async def reserve(self, **values: Any) -> None:
        self.reservations.append(values)


class NamedProvider:
    def __init__(self, name: str) -> None:
        self.name = name

    async def search(self, request: object) -> object:
        raise AssertionError(f"provider {self.name} should not have executed: {request}")


def test_settings_default_to_zero_cost_without_a_commercial_search_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://localhost/recruitintel")
    monkeypatch.delenv("ZERO_COST_MODE", raising=False)
    monkeypatch.delenv("YDC_API_KEY", raising=False)
    monkeypatch.delenv("SEARXNG_BASE_URL", raising=False)

    settings = Settings.from_environment()

    assert settings.zero_cost_mode
    assert settings.searxng_base_url is None
    assert not hasattr(settings, "ydc_api_key")


def test_zero_cost_registry_rejects_paid_provider_and_you_stays_disabled() -> None:
    registry = SearchProviderRegistry(
        [NamedProvider("you")],
        [YOU_SEARCH_DESCRIPTOR],
        zero_cost_mode=True,
    )

    with pytest.raises(SearchProviderCostBlockedError):
        registry.get("you")
    assert YOU_SEARCH_DESCRIPTOR.production_enabled is False
    assert YOU_SEARCH_DESCRIPTOR.terms_status == "REVIEW_REQUIRED"


def test_direct_discovery_is_bounded_and_known_sources_avoid_general_search() -> None:
    discovery = DirectSourceDiscovery()
    bounded = discovery.plan(company())
    assert bounded.general_search_recommended is False
    assert bounded.reason == "bounded_common_paths"
    assert bounded.probe_urls == (
        "https://example.com/careers",
        "https://example.com/jobs",
        "https://example.com/early-careers",
        "https://example.com/internships",
        "https://example.com/university",
    )

    covered = discovery.plan(
        company(),
        (
            KnownSourceCoverage(
                url="https://boards.greenhouse.io/example",
                source_type="ATS",
            ),
        ),
    )
    assert covered.probe_urls == ()
    assert not covered.general_search_recommended
    assert covered.reason == "known_direct_source"


def test_fetched_company_page_discovers_supported_and_future_ats_sources_once() -> None:
    document = FetchedDocument(
        requested_url="https://example.com",
        final_url="https://example.com",
        status_code=200,
        content_type="text/html",
        body="""
          <a href="/early-careers">Students</a>
          <a href="https://boards.greenhouse.io/ExampleCo">Open jobs</a>
          <a href="https://boards.greenhouse.io/ExampleCo?utm_source=again">Duplicate</a>
          <a href="https://acme.wd5.myworkdayjobs.com/External/jobs">Workday</a>
          <a href="https://boards.greenhouse.io/partnerco">Partner</a>
          <a href="https://unrelated.example/jobs">Unrelated</a>
        """,
    )

    results = DirectSourceDiscovery().discover(company(), document)

    pairs = {(item.provider, item.external_key) for item in results}
    assert ("greenhouse", "exampleco") in pairs
    assert ("workday", "acme.wd5.myworkdayjobs.com:external") in pairs
    assert len([item for item in results if item.provider == "public_web"]) == 1
    greenhouse = next(item for item in results if item.provider == "greenhouse")
    workday = next(item for item in results if item.provider == "workday")
    assert greenhouse.collector_supported
    assert greenhouse.discovery_method is SourceDiscoveryMethod.ATS_FINGERPRINT
    assert not workday.collector_supported
    assert len({item.fingerprint for item in results}) == len(results)


class FetchRepository:
    def __init__(self) -> None:
        self.discoveries: tuple[object, ...] = ()
        self.completed = False

    async def claim_work_request(self, request_id: UUID) -> PublicWebWorkRequest:
        assert request_id == REQUEST_ID
        return PublicWebWorkRequest(
            id=request_id,
            work_type=WebWorkType.FETCH,
            status=WebWorkStatus.RUNNING,
            company_id=COMPANY_ID,
            candidate_id=CANDIDATE_ID,
            attempt_count=1,
            max_attempts=3,
        )

    async def get_candidate(self, candidate_id: UUID) -> CandidateConfig:
        assert candidate_id == CANDIDATE_ID
        return CandidateConfig(
            id=candidate_id,
            company=company(),
            source_id=SOURCE_ID,
            canonical_url="https://example.com",
            original_url="https://example.com",
            source_provider="direct",
            fetch_status="PENDING",
        )

    async def start_run(self, request: PublicWebWorkRequest, source_id: UUID) -> UUID:
        assert request.id == REQUEST_ID and source_id == SOURCE_ID
        return RUN_ID

    async def persist_direct_sources(self, **values: Any) -> int:
        self.discoveries = tuple(values["discoveries"])
        return len(self.discoveries)

    async def persist_fetched_document(self, **values: Any) -> tuple[None, bool]:
        return None, False

    async def complete_run(self, run_id: UUID, stats: object) -> None:
        assert run_id == RUN_ID
        self.completed = True

    async def fail_run(self, *values: object) -> None:
        raise AssertionError(f"direct fetch unexpectedly failed: {values}")


class Fetcher:
    async def fetch(self, url: str) -> FetchedDocument:
        assert url == "https://example.com"
        return FetchedDocument(
            requested_url=url,
            final_url=url,
            status_code=200,
            content_type="text/html",
            body='<main>Careers <a href="https://jobs.lever.co/example">Open roles</a></main>',
            fetched_at=datetime(2026, 8, 24, tzinfo=UTC),
        )


@pytest.mark.asyncio
async def test_direct_source_fetch_runs_without_any_search_provider() -> None:
    repository = FetchRepository()
    worker = PublicWebWorker(
        repository=repository,  # type: ignore[arg-type]
        search_registry=SearchProviderRegistry([], []),
        fetcher=Fetcher(),
    )

    stats = await worker.run(REQUEST_ID)

    assert stats.direct_sources_discovered == 1
    assert repository.discoveries[0].provider == "lever"
    assert repository.completed


class SearchRepository:
    def __init__(self) -> None:
        self.batch: object | None = None

    async def claim_work_request(self, request_id: UUID) -> PublicWebWorkRequest:
        return PublicWebWorkRequest(
            id=request_id,
            work_type=WebWorkType.SEARCH,
            status=WebWorkStatus.RUNNING,
            company_id=COMPANY_ID,
            search_query_id=QUERY_ID,
            attempt_count=1,
            max_attempts=3,
        )

    async def get_search_query(self, query_id: UUID) -> SearchQueryConfig:
        assert query_id == QUERY_ID
        return SearchQueryConfig(
            id=query_id,
            company=company(careers_url="https://example.com/careers"),
            source_id=SOURCE_ID,
            provider="you",
            template_key="internship",
            query="Example internships",
            minimum_interval_seconds=3600,
            max_results=10,
            max_fetches=3,
        )

    async def has_direct_source_coverage(self, query: SearchQueryConfig) -> bool:
        return True

    async def start_run(self, request: PublicWebWorkRequest, source_id: UUID) -> UUID:
        return RUN_ID

    async def persist_search_results(self, **values: Any) -> tuple[int, tuple[UUID, ...]]:
        self.batch = values["batch"]
        return 0, ()

    async def complete_run(self, run_id: UUID, stats: object) -> None:
        return None

    async def fail_run(self, *values: object) -> None:
        raise AssertionError(f"covered search unexpectedly failed: {values}")


class UnusedFetcher:
    async def fetch(self, url: str) -> FetchedDocument:
        raise AssertionError(f"unexpected fetch: {url}")


@pytest.mark.asyncio
async def test_known_career_source_short_circuits_paid_search_provider() -> None:
    repository = SearchRepository()
    worker = PublicWebWorker(
        repository=repository,  # type: ignore[arg-type]
        search_registry=SearchProviderRegistry(
            [NamedProvider("you")],
            [YOU_SEARCH_DESCRIPTOR],
            zero_cost_mode=True,
        ),
        fetcher=UnusedFetcher(),
    )

    stats = await worker.run(REQUEST_ID)

    assert stats.general_search_skipped
    assert stats.provider_calls == 0
    assert stats.paid_spend_micros == 0


@pytest.mark.asyncio
async def test_optional_searxng_normalizes_results_and_direct_work_survives_outage() -> None:
    calls: list[httpx.Request] = []
    budget = Budget()

    def result_handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            200,
            headers={"Content-Type": "application/json"},
            json={
                "results": [
                    {
                        "url": "https://example.com/jobs?utm_source=searxng",
                        "title": "T" * 700,
                        "content": "S" * 2_500,
                        "category": "news",
                        "publishedDate": "2026-08-23T10:00:00Z",
                        "engine": "not-retained",
                    },
                    {"url": "http://127.0.0.1/private", "title": "unsafe"},
                    {"title": "malformed"},
                ]
            },
            request=request,
        )

    async with SearXNGProvider(
        base_url="http://searxng:8080",
        budget=budget,
        transport=httpx.MockTransport(result_handler),
    ) as provider:
        batch = await provider.search(
            SearchRequest(query="Example internships", max_results=10, language="en-US")
        )

    assert str(calls[0].url).startswith(
        "http://searxng:8080/search?q=Example+internships&format=json&pageno=1"
    )
    assert [item.url for item in batch.results] == ["https://example.com/jobs"]
    assert batch.results[0].result_kind is SearchResultKind.NEWS
    assert len(batch.results[0].title) == 500
    assert len(batch.results[0].snippet) == 2_000
    assert batch.results[0].metadata.model_dump(exclude_none=True) == {
        "page_offset": 0,
        "section_rank": 1,
    }
    assert budget.reservations[0]["paid_spend_micros"] == 0

    async with SearXNGProvider(
        base_url="http://searxng:8080",
        budget=budget,
        transport=httpx.MockTransport(
            lambda request: (_ for _ in ()).throw(httpx.ConnectError("offline", request=request))
        ),
    ) as unavailable:
        with pytest.raises(SearchProviderRetryableError):
            await unavailable.search(SearchRequest(query="Example internships", max_results=10))

    direct = DirectSourceDiscovery().discover(
        company(),
        FetchedDocument(
            requested_url="https://example.com",
            final_url="https://example.com",
            status_code=200,
            content_type="text/html",
            body='<a href="https://jobs.lever.co/example">Jobs</a>',
        ),
    )
    assert [item.provider for item in direct] == ["lever"]
    assert SEARXNG_SEARCH_DESCRIPTOR.production_enabled is False
    assert SEARXNG_SEARCH_DESCRIPTOR.terms_status == "REVIEW_REQUIRED"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "error_type", "code"),
    [
        (429, SearchProviderRateLimitedError, "SEARCH_PROVIDER_RATE_LIMITED"),
        (401, SearchProviderAuthRequiredError, "SEARCH_PROVIDER_AUTH_REQUIRED"),
        (403, SearchProviderPermanentError, "SEARXNG_API_NOT_ENABLED"),
        (422, SearchProviderPermanentError, "SEARCH_PROVIDER_INVALID_REQUEST"),
        (503, SearchProviderRetryableError, "SEARCH_PROVIDER_UNAVAILABLE"),
    ],
)
async def test_searxng_failures_map_without_leaking_instance_payload(
    status: int,
    error_type: type[Exception],
    code: str,
) -> None:
    budget = Budget()
    async with SearXNGProvider(
        base_url="http://searxng:8080",
        budget=budget,
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                status,
                headers={"Retry-After": "30"},
                content=b"provider-secret-body",
                request=request,
            )
        ),
    ) as provider:
        with pytest.raises(error_type) as caught:
            await provider.search(SearchRequest(query="Example internships", max_results=10))
    assert caught.value.code == code
    assert "provider-secret-body" not in str(caught.value)
    assert len(budget.reservations) == 1
